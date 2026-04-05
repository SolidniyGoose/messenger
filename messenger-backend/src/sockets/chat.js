// Справочник: Никнейм -> ID Сокета
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const onlineUsers = new Map();

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Новое физическое подключение: ${socket.id}`);

        // 1. Клиент сообщает, как его зовут
        socket.on('register_user', (username) => {
            onlineUsers.set(username, socket.id);
            console.log(`👤 Пользователь ${username} привязан к сокету ${socket.id}`);
        });

        // 2. Обработка зашифрованных сообщений
        socket.on('send_message', async (data) => {
            try {
                const payload = JSON.parse(data.text);
                const recipientSocketId = onlineUsers.get(payload.recipient);

                // 1. СОХРАНЯЕМ В БАЗУ ДАННЫХ (в зашифрованном виде!)
                await prisma.message.create({
                    data: {
                        sender: payload.sender,
                        recipient: payload.recipient,
                        secretBox: payload.secretBox // Сервер сохраняет это как JSON, не пытаясь прочитать
                    }
                });

                // 2. Отправляем получателю, если он онлайн
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('receive_message', data);
                }
            } catch (e) {
                console.error("Ошибка маршрутизации сообщения:", e);
            }
        });

        // 3. Обработка отключения
        socket.on('disconnect', () => {
            // Ищем, кто именно отключился, и удаляем из справочника
            for (let [username, id] of onlineUsers.entries()) {
                if (id === socket.id) {
                    onlineUsers.delete(username);
                    console.log(`❌ Пользователь ушел в офлайн: ${username}`);
                    break;
                }
            }
        });
    });
};