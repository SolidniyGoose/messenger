require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Настраиваем CORS, чтобы фронтенд мог стучаться к нашему API
app.use(cors({
    origin: '*', // В продакшене здесь будет домен вашего фронтенда
    methods: ['GET', 'POST']
}));
app.use(express.json());

const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// Инициализация Socket.IO
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Вынесем логику сокетов в отдельный модуль (создадим его позже)
require('./sockets/chat')(io);

// Простой проверочный роут
app.get('/api/health', (req, res) => {
    res.json({ status: 'Server is running perfectly' });
});

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Эндпоинт для загрузки зашифрованной истории
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
            orderBy: { createdAt: 'asc' } // Сортируем по времени (старые сверху)
        });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: "Ошибка загрузки истории" });
    }
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});