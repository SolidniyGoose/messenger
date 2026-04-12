const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearDB() {
    try {
        console.log("Очистка базы данных...");
        
        // Порядок ВАЖЕН! Сначала удаляем сообщения, потом участников, потом группы, потом юзеров.
        await prisma.message.deleteMany();
        await prisma.groupMember.deleteMany();
        await prisma.group.deleteMany();
        await prisma.user.deleteMany();
        
        console.log("✅ База данных девственно чиста (включая группы)!");
    } catch (e) {
        console.error("❌ ОШИБКА ПРИ ОЧИСТКЕ:", e);
    } finally {
        await prisma.$disconnect();
    }
}

clearDB();