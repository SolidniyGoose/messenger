const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const onlineUsers = new Map(); 

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Новое подключение: ${socket.id}`);

        socket.on('register_user', (username) => {
            onlineUsers.set(username, socket.id);
            console.log(`👤 ${username} привязан к ${socket.id}`);
        });

        socket.on('send_message', async (data) => {
            try {
                const payload = JSON.parse(data.text);
                const recipientSocketId = onlineUsers.get(payload.recipient);

                // --- САМОЕ ВАЖНОЕ: СОХРАНЯЕМ В БАЗУ ДАННЫХ ---
                await prisma.message.create({
                    data: {
                        sender: payload.sender,
                        recipient: payload.recipient,
                        secretBox: payload.secretBox 
                    }
                });

                // Отправляем адресату, если он онлайн
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('receive_message', data);
                }
            } catch (e) {
                console.error("Ошибка маршрутизации:", e);
            }
        });

        socket.on('disconnect', () => {
            for (let [username, id] of onlineUsers.entries()) {
                if (id === socket.id) {
                    onlineUsers.delete(username);
                    break;
                }
            }
        });
    });
};