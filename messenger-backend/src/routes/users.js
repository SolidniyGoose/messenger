const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Эндпоинт для регистрации или обновления ключа
router.post('/register', async (req, res) => {
    const { username, publicKey } = req.body;
    
    if (!username || !publicKey) {
        return res.status(400).json({ error: "Нужен никнейм и ключ!" });
    }

    try {
        // upsert: если пользователь есть - обновляем ключ, если нет - создаем нового
        const user = await prisma.user.upsert({
            where: { username: username },
            update: { publicKey: publicKey },
            create: { username, publicKey }
        });
        
        res.json({ success: true, user });
    } catch (error) {
        console.error("Ошибка БД:", error);
        res.status(500).json({ error: "Ошибка при сохранении пользователя" });
    }
});

// Эндпоинт для получения списка всех пользователей
router.get('/', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { id: true, username: true, publicKey: true } 
        });
        res.json(users);
    } catch (error) {
        // Отправляем всю подноготную ошибки прямо на экран!
        res.status(500).json({ 
            error: "Ошибка получения списка", 
            details: error.message,
            name: error.name
        });
    }
});

module.exports = router;