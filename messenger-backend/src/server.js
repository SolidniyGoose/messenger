require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '50mb' }));

const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// --- ИСТОРИЯ ЧАТОВ (То, что мы забыли добавить) ---
app.get('/api/history/:user1/:user2', async (req, res) => {
    const { user1, user2 } = req.params;
    try {
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender: user1, recipient: user2 },
                    { sender: user2, recipient: user1 }
                ]
            },
            orderBy: { createdAt: 'asc' } 
        });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});
// --- ЭНДПОИНТ ДЛЯ ИСТОРИИ ГРУППОВОГО ЧАТА ---
app.get('/api/history/group/:groupId', async (req, res) => {
    try {
        const messages = await prisma.message.findMany({
            where: { 
                groupId: req.params.groupId 
            },
            orderBy: { 
                createdAt: 'asc' // Сортируем от старых к новым
            }
        });
        res.json(messages);
    } catch (error) {
        console.error("Ошибка загрузки истории группы:", error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// --- ЭНДПОИНТ ДЛЯ СОЗДАНИЯ ГРУППЫ ---
app.post('/api/groups/create', async (req, res) => {
    try {
        const { groupName, members } = req.body;

        // Используем Prisma, чтобы создать группу и сразу прикрепить к ней всех участников
        const newGroup = await prisma.group.create({
            data: {
                name: groupName,
                // Магия Prisma: создаем связанные записи (GroupMember) на лету
                members: {
                    create: members.map(m => ({
                        username: m.username,
                        encryptedKeyBox: m.encryptedKeyBox
                    }))
                }
            }
        });

        console.log(`Группа "${groupName}" успешно создана в БД! ID: ${newGroup.id}`);
        res.json({ success: true, group: newGroup });
        
    } catch (error) {
        console.error("Ошибка при создании группы в БД:", error);
        res.status(500).json({ success: false, error: "Не удалось создать группу" });
    }
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
