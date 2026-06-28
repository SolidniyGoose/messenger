const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Хелпер для хэширования
const getAvatarHash = (avatarStr) => {
    if (!avatarStr) return null;
    return crypto.createHash('md5').update(avatarStr).digest('hex');
};

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

// 5. УМНЫЙ ПОИСК ПОЛЬЗОВАТЕЛЕЙ (Поиск по нику или имени)
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { username: { contains: q, mode: 'insensitive' } },
                    { displayName: { contains: q, mode: 'insensitive' } } // Регистронезависимый поиск
                ]
            },
            select: { username: true, displayName: true, avatar: true, bio: true, publicKey: true },
            take: 15 // Ограничиваем выдачу
        });
        
        // Удаляем саму аватарку, возвращаем только хэш
        const usersWithHashes = users.map(u => {
            const hash = getAvatarHash(u.avatar);
            delete u.avatar;
            return { ...u, avatarHash: hash };
        });

        res.json(usersWithHashes);
    } catch (error) {
        console.error("Ошибка при поиске пользователей:", error);
        res.status(500).json({ error: "Ошибка поиска" });
    }
// 6. ПОЛУЧЕНИЕ ИСТОРИИ АВАТАРОК ПОЛЬЗОВАТЕЛЯ
router.get('/:username/avatars', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username: req.params.username },
            select: { avatarHistory: true }
        });
        if (!user || !user.avatarHistory) return res.json([]);
        
        let history = [];
        if (typeof user.avatarHistory === 'string') {
            history = JSON.parse(user.avatarHistory);
        } else if (Array.isArray(user.avatarHistory)) {
            history = user.avatarHistory;
        }
        res.json(history);
    } catch (error) {
        console.error("Ошибка при получении истории аватарок:", error);
        res.status(500).json({ error: "Ошибка" });
    }
});

// 7. УДАЛЕНИЕ АВАТАРКИ ИЗ ИСТОРИИ
router.delete('/avatars/:index', async (req, res) => {
    try {
        const { username } = req.body;
        const index = parseInt(req.params.index);
        
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(404).json({ error: "Не найден" });

        let history = [];
        if (user.avatarHistory) {
            if (typeof user.avatarHistory === 'string') history = JSON.parse(user.avatarHistory);
            else if (Array.isArray(user.avatarHistory)) history = user.avatarHistory;
        }

        if (index >= 0 && index < history.length) {
            history.splice(index, 1);
            
            // Если мы удалили текущую аватарку (index 0) - обновляем главную
            const newCurrentAvatar = history.length > 0 ? history[0] : null;
            
            await prisma.user.update({
                where: { username },
                data: { 
                    avatarHistory: history,
                    avatar: newCurrentAvatar
                }
            });
            res.json({ success: true, newAvatar: newCurrentAvatar, avatarHistory: history });
        } else {
            res.status(400).json({ error: "Неверный индекс" });
        }
    } catch (e) {
        console.error("Ошибка удаления аватарки:", e);
        res.status(500).json({ error: "Ошибка удаления" });
    }
});

// 5.5. ПОЛУЧЕНИЕ САМОЙ АВАТАРКИ (Для кэширования IndexedDB)
router.get('/:username/avatar', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username: req.params.username },
            select: { avatar: true }
        });
        if (!user || !user.avatar) return res.json({ avatar: null });
        res.json({ avatar: user.avatar });
    } catch (error) {
        res.status(500).json({ error: "Ошибка БД" });
    }
});

// 2. ПОЛУЧЕНИЕ ДАННЫХ КОНКРЕТНОГО ПОЛЬЗОВАТЕЛЯ (ДЛЯ ВХОДА)
router.get('/:username', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username: req.params.username }
        });
        
        if (user) {
            user.avatarHash = getAvatarHash(user.avatar);
            delete user.avatar;
        }

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
                avatar: true,
                bio: true
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
            select: { username: true, displayName: true, avatar: true, bio: true, publicKey: true }
        });

        const activeUsersWithHashes = activeUsers.map(u => {
            const hash = getAvatarHash(u.avatar);
            delete u.avatar;
            return { ...u, avatarHash: hash };
        });

        res.json(activeUsersWithHashes);
    } catch (error) {
        console.error("Ошибка при получении чатов:", error);
        res.status(500).json({ error: "Ошибка получения чатов" });
    }
});


module.exports = router;