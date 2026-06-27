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

    // --- 🛡️ БЕЗОПАСНОСТЬ: ЖЕСТКАЯ ПРОВЕРКА ИМЕНИ ---
    // Разрешаем только английские/русские буквы, цифры и символы _ - (от 3 до 30 символов)
    const usernameRegex = /^[a-zA-Zа-яА-Я0-9_-]{3,30}$/;
    if (!usernameRegex.test(username)) {
        return res.status(400).json({ error: "Недопустимый никнейм. Используйте только буквы, цифры и символы - _" });
    }
    // ------------------------------------------------

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

// 3. СПИСОК КОНТАКТОВ (Облегченный для бокового меню)
router.get('/', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { 
                username: true, 
                publicKey: true,
                displayName: true,
                avatar: true // <--- ВЕРНУЛИ
                // УБРАЛИ avatar: true (Теперь этот JSON будет весить 5 КБ вместо 250 КБ!)
            } 
        });
        res.json(users);
    } catch (error) {
        console.error("Ошибка при получении списка пользователей:", error);
        res.status(500).json({ error: "Ошибка получения списка" });
    }
});

// 4. ПОЛУЧЕНИЕ СПИСКА АКТИВНЫХ ЧАТОВ ПОЛЬЗОВАТЕЛЯ
router.get('/:username/chats', async (req, res) => {
    try {
        const { username } = req.params;
        // Ищем только личные сообщения
        const messages = await prisma.message.findMany({
            where: {
                groupId: null,
                OR: [
                    { sender: username },
                    { recipient: username }
                ]
            },
            select: { sender: true, recipient: true }
        });

        // Собираем уникальные имена собеседников
        const chatUsers = new Set();
        messages.forEach(msg => {
            if (msg.sender && msg.sender !== username) chatUsers.add(msg.sender);
            if (msg.recipient && msg.recipient !== username) chatUsers.add(msg.recipient);
        });

        // Получаем полные профили собеседников (чтобы не качать всю БД при старте)
        const activeUsers = await prisma.user.findMany({
            where: { username: { in: Array.from(chatUsers) } },
            select: { username: true, displayName: true, avatar: true, publicKey: true }
        });

        res.json(activeUsers);
    } catch (error) {
        console.error("Ошибка при получении чатов:", error);
        res.status(500).json({ error: "Ошибка получения чатов" });
    }
});

// 5. УМНЫЙ ПОИСК ПОЛЬЗОВАТЕЛЕЙ (Поиск по нику или имени)
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { username: { contains: q } },
                    { displayName: { contains: q } } // Регистронезависимый поиск в SQLite
                ]
            },
            select: { username: true, displayName: true, avatar: true, publicKey: true },
            take: 15 // Ограничиваем выдачу
        });
        res.json(users);
    } catch (error) {
        console.error("Ошибка при поиске пользователей:", error);
        res.status(500).json({ error: "Ошибка поиска" });
    }
});

module.exports = router;