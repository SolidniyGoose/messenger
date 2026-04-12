require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearDB() {
    console.log("🧹 Начинаем уборку...");

    // Сначала удаляем сообщения (так как они зависят от пользователей)
    const deletedMessages = await prisma.message.deleteMany({});
    console.log(`🗑 Удалено сообщений: ${deletedMessages.count}`);

    // Затем удаляем самих пользователей
    const deletedUsers = await prisma.user.deleteMany({});
    console.log(`🗑 Удалено пользователей: ${deletedUsers.count}`);

    console.log("✨ База данных абсолютно чиста!");
}

clearDB()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
