const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const onlineUsers = new Map(); 

module.exports = (io) => {
    io.on('connection', (socket) => {
        
        // --- ОБНОВЛЕННАЯ РЕГИСТРАЦИЯ СОКЕТА ---
        socket.on('register_user', async (username) => {
            try {
                const userExists = await prisma.user.findUnique({ where: { username: username } });
                if (!userExists) {
                    socket.emit('force_logout');
                    return;
                }
                onlineUsers.set(username, socket.id);
                
                // НОВОЕ: Сообщаем всем, что этот пользователь теперь В СЕТИ
                io.emit('user_status_change', { username: username, isOnline: true });
                
            } catch (e) { console.error("Ошибка при проверке пользователя:", e); }
        });

        // НОВОЕ: Эндпоинт, чтобы клиент мог спросить "А этот юзер сейчас онлайн?"
        socket.on('check_online_status', (username, callback) => {
            if (typeof callback === 'function') {
                callback(onlineUsers.has(username));
            }
        });

        // --- НОВОЕ: ИНДИКАТОР "ПЕЧАТАЕТ..." ---
        socket.on('typing', async (data) => {
            if (data.isGroup) {
                const group = await prisma.group.findUnique({ where: { id: data.groupId }, include: { members: true } });
                if (group) {
                    group.members.forEach(m => {
                        if (m.username !== data.sender) { // Отправляем всем, кроме себя
                            const sId = onlineUsers.get(m.username);
                            if (sId) io.to(sId).emit('user_typing', data);
                        }
                    });
                }
            } else {
                const sId = onlineUsers.get(data.recipient);
                if (sId) io.to(sId).emit('user_typing', data);
            }
        });

        socket.on('stop_typing', async (data) => {
            if (data.isGroup) {
                const group = await prisma.group.findUnique({ where: { id: data.groupId }, include: { members: true } });
                if (group) {
                    group.members.forEach(m => {
                        if (m.username !== data.sender) {
                            const sId = onlineUsers.get(m.username);
                            if (sId) io.to(sId).emit('user_stopped_typing', data);
                        }
                    });
                }
            } else {
                const sId = onlineUsers.get(data.recipient);
                if (sId) io.to(sId).emit('user_stopped_typing', data);
            }
        });

        // ... (дальше идут ваши старые socket.on('send_message') и т.д.)

        // --- ОБНОВЛЕННАЯ МАРШРУТИЗАЦИЯ СООБЩЕНИЙ ---
        socket.on('send_message', async (data) => {
            try {
                const payload = JSON.parse(data.text);

                if (payload.isGroup) {
                    const group = await prisma.group.findUnique({
                        where: { id: payload.groupId },
                        include: { members: true }
                    });

                    if (!group) return;

                    // --- 🛡️ ЗАЩИТА КАНАЛА ---
                    if (group.isChannel) {
                        // Читаем, является ли сообщение комментарием
                        const isComment = payload.secretBox && payload.secretBox.isComment === true;

                        const mySafe = group.members.find(m => m.username === payload.sender);
                        if (mySafe) {
                            const safeData = typeof mySafe.encryptedKeyBox === 'string' ? JSON.parse(mySafe.encryptedKeyBox) : mySafe.encryptedKeyBox;
                            const admin = safeData.encryptedBy; 
                            
                            // Блокируем, только если это НЕ админ И это НЕ комментарий
                            if (payload.sender !== admin && !isComment) {
                                console.warn(`Блокировка: ${payload.sender} не админ, и это не коммент!`);
                                return; 
                            }
                        }
                    }

                    // ВАЖНО: Сохраняем в базу с указанием groupId
                    console.log(`[SOCKET] Пытаемся сохранить сообщение в БД для группы: ${payload.groupId}`); // <--- СЛЕЖКА
                    
                    const savedMsg = await prisma.message.create({
                        data: {
                            id: payload.id,
                            sender: payload.sender,
                            groupId: payload.groupId,
                            secretBox: payload.secretBox
                        }
                    });
                    
                    console.log(`[SOCKET] ✅ Сообщение успешно записано в БД! ID: ${savedMsg.id}`); // <--- СЛЕЖКА

                    // Рассылка участникам
                    group.members.forEach(member => {
                        if (member.username !== payload.sender) {
                            const memberSocketId = onlineUsers.get(member.username);
                            if (memberSocketId) io.to(memberSocketId).emit('receive_message', { text: JSON.stringify(payload) });
                        }
                    });
                } else {
                    // Личные сообщения
                    await prisma.message.create({
                        data: {
                            id: payload.id,
                            sender: payload.sender,
                            recipient: payload.recipient,
                            secretBox: payload.secretBox
                        }
                    });
                    const recipientSocketId = onlineUsers.get(payload.recipient);
                    if (recipientSocketId) io.to(recipientSocketId).emit('receive_message', { text: JSON.stringify(payload) });
                }
            } catch (e) { console.error("Ошибка записи в базу:", e); }
        });

        // --- НОВОЕ: УДАЛЕНИЕ СООБЩЕНИЯ ---
        socket.on('delete_message', async (data) => {
            try {
                // 1. Удаляем из базы данных
                await prisma.message.delete({ where: { id: data.messageId } });
                
                // 2. Рассылаем команду на удаление нужным людям
                if (data.isGroup) {
                    const group = await prisma.group.findUnique({ where: { id: data.groupId }, include: { members: true }});
                    if (group) {
                        group.members.forEach(m => {
                            const sId = onlineUsers.get(m.username);
                            if (sId) io.to(sId).emit('message_deleted', data.messageId);
                        });
                    }
                } else {
                    const recipientSocketId = onlineUsers.get(data.recipient);
                    const senderSocketId = onlineUsers.get(data.sender);
                    if (recipientSocketId) io.to(recipientSocketId).emit('message_deleted', data.messageId);
                    if (senderSocketId) io.to(senderSocketId).emit('message_deleted', data.messageId); // Отправляем и себе для синхронизации
                }
            } catch (e) { console.error("Ошибка при удалении сообщения:", e); }
        });

        // --- НОВОЕ: ОБРАБОТКА ПРОЧИТАННЫХ СООБЩЕНИЙ ---
        socket.on('mark_read', async ({ sender, recipient }) => {
            try {
                // В БД помечаем все сообщения от sender к recipient как прочитанные
                await prisma.message.updateMany({
                    where: { sender: sender, recipient: recipient, isRead: false },
                    data: { isRead: true }
                });
                
                // Если отправитель онлайн - мгновенно говорим ему нарисовать две галочки
                const senderSocketId = onlineUsers.get(sender);
                if (senderSocketId) {
                    io.to(senderSocketId).emit('messages_were_read', { by: recipient });
                }
            } catch (e) { console.error("Ошибка статуса:", e); }
        });

        // --- ОБНОВЛЕННОЕ ОТКЛЮЧЕНИЕ ---
        socket.on('disconnect', () => {
            for (let [username, id] of onlineUsers.entries()) {
                if (id === socket.id) {
                    onlineUsers.delete(username);
                    // НОВОЕ: Сообщаем всем, что этот пользователь ВЫШЕЛ ИЗ СЕТИ
                    io.emit('user_status_change', { username: username, isOnline: false });
                    break;
                }
            }
        });
    });
};