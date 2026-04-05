const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. РЕГИСТРАЦИЯ ИЛИ ОБНОВЛЕНИЕ КЛЮЧЕЙ
router.post('/register', async (req, res) => {
    const { username, publicKey, encryptedPrivKey } = req.body;
    
    if (!username || !publicKey || !encryptedPrivKey) {
        return res.status(400).json({ error: "Нужны все данные!" });
    }

    try {
        const user = await prisma.user.upsert({
            where: { username: username },
            update: { publicKey, encryptedPrivKey },
            create: { username, publicKey, encryptedPrivKey }
        });
        res.json({ success: true, user });
    } catch (error) {
        console.error("Ошибка БД:", error);
        res.status(500).json({ error: "Ошибка при сохранении пользователя" });
    }
});

// 2. ПОЛУЧЕНИЕ ДАННЫХ КОНКРЕТНОГО ПОЛЬЗОВАТЕЛЯ (ДЛЯ ВХОДА)
router.get('/:username', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username: req.params.username }
        });
        res.json(user || { error: "Не найден" });
    } catch (error) {
        res.status(500).json({ error: "Ошибка БД" });
    }
});

// 3. СПИСОК КОНТАКТОВ (Без раздачи чужих приватных ключей!)
router.get('/', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { id: true, username: true, publicKey: true } // Сейфы не отдаем в общий список
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: "Ошибка получения списка" });
    }
});

module.exports = router;