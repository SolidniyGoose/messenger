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

// --- ЭНДПОИНТ ДЛЯ ПОЛУЧЕНИЯ ГРУПП ПОЛЬЗОВАТЕЛЯ ---
app.get('/api/users/:username/groups', async (req, res) => {
    try {
        const username = req.params.username;
        const groups = await prisma.group.findMany({
            where: {
                members: {
                    some: { username: username } // Ищем группы, где есть этот юзер
                }
            },
            include: {
                members: true // Включаем участников, чтобы знать их количество
            }
        });
        res.json(groups);
    } catch (error) {
        console.error("Ошибка при получении групп:", error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
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
