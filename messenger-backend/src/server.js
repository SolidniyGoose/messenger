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

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});