require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

const app = express();

// --- 🛡️ НАСТРОЙКА БЕЗОПАСНОСТИ (CSP) ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Разрешаем скрипты только с нашего сайта и CDN для Socket.io. 
            // 'unsafe-inline' нужен, так как у нас скрипты написаны прямо внутри index.html
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"], 
            // Разрешаем стили из файлов и внутри тегов
            styleSrc: ["'self'", "'unsafe-inline'"],
            // Разрешаем загрузку картинок и видео (blob: нужен для расшифрованных медиафайлов!)
            imgSrc: ["'self'", "data:", "blob:"],
            mediaSrc: ["'self'", "blob:"],
            // Разрешаем подключаться по WebSockets
            connectSrc: ["'self'", "ws:", "wss:"], 
        },
    }
}));

const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '50mb' }));

const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// --- ЭНДПОИНТ ДЛЯ ИСТОРИИ ГРУППОВОГО ЧАТА (С ПАГИНАЦИЕЙ) ---
app.get('/api/history/group/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const limit = parseInt(req.query.limit) || 30;   // Сколько сообщений отдавать (по умолчанию 30)
    const offset = parseInt(req.query.offset) || 0;  // Сколько пропустить с конца

    try {
        const messages = await prisma.message.findMany({
            where: { groupId: groupId },
            orderBy: { createdAt: 'desc' }, // Берем с КОНЦА (самые свежие из старых)
            take: limit,
            skip: offset
        });
        
        res.json(messages.reverse()); // Переворачиваем обратно, чтобы хронология была правильной (старые сверху)
    } catch (error) { 
        console.error("❌ Ошибка истории группы:", error); 
        res.status(500).json([]); 
    }
});

// --- ИСТОРИЯ ЛИЧНЫХ ЧАТОВ (С ПАГИНАЦИЕЙ) ---
app.get('/api/history/:user1/:user2', async (req, res) => {
    const { user1, user2 } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender: user1, recipient: user2 },
                    { sender: user2, recipient: user1 }
                ]
            },
            orderBy: { createdAt: 'desc' }, // Берем с КОНЦА
            take: limit,
            skip: offset
        });
        res.json(messages.reverse());
    } catch (error) {
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});

// --- ЭНДПОИНТ ДЛЯ ПОЛУЧЕНИЯ ОДНОГО СООБЩЕНИЯ ---
app.get('/api/messages/single/:id', async (req, res) => {
    try {
        const msg = await prisma.message.findUnique({
            where: { id: req.params.id }
        });
        if (msg) res.json(msg);
        else res.status(404).json({ error: "Не найдено" });
    } catch (e) {
        console.error("Ошибка загрузки сообщения:", e);
        res.status(500).json({ error: "Ошибка" });
    }
});

// --- ОБНОВЛЕННЫЙ ЭНДПОИНТ СОЗДАНИЯ ---
app.post('/api/groups/create', async (req, res) => {
    try {
        const { groupName, members, isChannel, isPublic } = req.body; // Получаем новые флаги

        const newGroup = await prisma.group.create({
            data: {
                name: groupName,
                isChannel: isChannel || false,
                isPublic: isPublic || false,
                members: {
                    create: members.map(m => ({
                        username: m.username,
                        encryptedKeyBox: m.encryptedKeyBox
                    }))
                }
            }
        });

        console.log(`Создан ${isChannel ? 'Канал' : 'Группа'}: "${groupName}"`);
        res.json({ success: true, group: newGroup });
        
    } catch (error) {
        console.error("Ошибка при создании:", error);
        res.status(500).json({ success: false, error: "Не удалось создать" });
    }
});

// --- ПОИСК ПУБЛИЧНЫХ КАНАЛОВ ---
app.get('/api/channels/search', async (req, res) => {
    const { query } = req.query;
    try {
        const channels = await prisma.group.findMany({
            where: {
                isChannel: true,
                isPublic: true,
                name: { contains: query, mode: 'insensitive' } // Поиск без учета регистра
            },
            select: {
                id: true,
                name: true,
                avatar: true,
                _count: { select: { members: true } }
            }
        });
        res.json(channels);
    } catch (e) { res.status(500).json({ error: "Ошибка поиска" }); }
});

// --- ЭНДПОИНТ ДЛЯ ПОЛУЧЕНИЯ ГРУПП (ОБЛЕГЧЕННЫЙ - ТОЛЬКО ДЛЯ САЙДБАРА) ---
app.get('/api/users/:username/groups', async (req, res) => {
    try {
        const username = req.params.username;
        const groups = await prisma.group.findMany({
            where: {
                members: { some: { username: username } }
            },
            select: {
                id: true,
                name: true,
                avatar: true,
                // members - НЕ запрашиваем (чтобы не тянуть тяжелые ключи)
                _count: { select: { members: true } } // Магия Prisma: просим только КОЛИЧЕСТВО участников
            }
        });
        res.json(groups);
    } catch (error) { res.status(500).json({ error: "Ошибка сервера" }); }
});

// --- НОВЫЙ ЭНДПОИНТ: ПОЛУЧЕНИЕ 100% ИНФОРМАЦИИ О КОНКРЕТНОЙ ГРУППЕ ---
app.get('/api/groups/:id', async (req, res) => {
    try {
        const group = await prisma.group.findUnique({
            where: { id: req.params.id },
            include: { members: true } // Здесь забираем всё (и аватар, и ключи участников)
        });
        res.json(group);
    } catch (error) { res.status(500).json({ error: "Ошибка" }); }
});

// Обновление профиля пользователя
app.post('/api/users/update', async (req, res) => {
    const { username, displayName, avatar } = req.body;

    // --- 🛡️ ЗАЩИТА ОТОБРАЖАЕМОГО ИМЕНИ ---
    if (displayName && displayName.length > 40) {
        return res.status(400).json({ success: false, error: "Имя слишком длинное!" });
    }
    if (displayName && /[<>]/.test(displayName)) {
        return res.status(400).json({ success: false, error: "Имя содержит запрещенные символы!" });
    }

    try {
        const updatedUser = await prisma.user.update({
            where: { username },
            data: { displayName, avatar }
        });
        res.json({ success: true, user: updatedUser });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// Обновление аватара группы
app.post('/api/groups/:id/update-avatar', async (req, res) => {
    const { avatar } = req.body;
    try {
        await prisma.group.update({
            where: { id: req.params.id },
            data: { avatar }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// Выйти из группы
app.post('/api/groups/:id/leave', async (req, res) => {
    const { username } = req.body;
    try {
        await prisma.groupMember.deleteMany({
            where: { groupId: req.params.id, username: username }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Удалить группу полностью
app.delete('/api/groups/:id', async (req, res) => {
    try {
        const groupId = req.params.id;
        await prisma.message.deleteMany({ where: { groupId } });
        await prisma.groupMember.deleteMany({ where: { groupId } });
        await prisma.group.delete({ where: { id: groupId } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Инициализация Socket.IO с увеличенным лимитом для файлов
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 5e7 // Увеличиваем лимит до 50 Мегабайт
});
require('./sockets/chat')(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});
