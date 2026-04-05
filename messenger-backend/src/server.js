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
app.use(express.json());

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

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
require('./sockets/chat')(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});