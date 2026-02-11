/* ANTIGRAVITY TELEGRAM BRIDGE (V13.0 - PROACTIVE STATUS MSG) */
// Copy this code and paste it into the antigravity IDE DevTools
(function () {
    const CONFIG = {
        token: "",
        chatId: ""
    };
    let lastUpdateId = 0;
    let isWaitingForAgent = false;
    let lastHandledUpdateId = 0;
    let pollIsRunning = false; // Guard to prevent multiple poll chains
    let streamRound = 0; // Đếm số lần stream đã hoàn tất
    let telegramUpdateQueue = Promise.resolve(); // Serialize Telegram updates

    // Command & Control State
    let isChatActive = true;   // Default: Chat with Agent ON

    // Commands List
    const COMMANDS_HELP = `🤖 DANH SÁCH LỆNH:
/chat on : Bật chat với Agent
/chat off: Tắt chat với Agent
/list    : Xem danh sách này`;

    // State for streaming response
    let streamState = {
        messageIds: [],
        lastFullText: "",
        lastSendTime: 0,
        pendingSend: false,
    };

    const STREAM_CONFIG = {
        IDLE_TIMEOUT: 3000,     // 3s fallback nếu agent status không rõ
        AGENT_DONE_TIMEOUT: 500, // 500ms khi agent RÕ RÀNG đã xong (Stop ẩn + Send sáng)
        THROTTLE_MS: 800,       // Gửi lên Telegram tối đa 0.8s/lần
    };

    function getAgentDoc() {
        const iframe = document.getElementById('antigravity.agentPanel');
        if (!iframe) return null;
        try { return iframe.contentDocument || iframe.contentWindow.document; }
        catch (e) { return null; }
    }

    // Kiểm tra xem Agent có đang bận xử lý hay không
    function isAgentBusy(doc) {
        // 1. Kiểm tra nút Stop (nếu hiện -> đang chạy)
        const stopVisible = isStopButtonVisible(doc);
        if (stopVisible) return { busy: true, reason: "Stop button hiện" };

        // 2. Kiểm tra nút Send (chỉ cần hiện diện, ko quan tâm sáng/tối)
        const sendBtn = doc.querySelector('button[data-tooltip-id="input-send-button-send-tooltip"]') ||
            doc.querySelector('button[aria-label="Send Message"]');
        const sendVisible = sendBtn && sendBtn.offsetParent !== null;

        if (sendVisible) return { busy: false, reason: "Send button đã hiện" };

        // Nếu cả Stop và Send đều không rõ ràng, coi là đang bận (đang load)
        return { busy: true, reason: "Đang chờ trạng thái ổn định" };
    }

    // Kiểm tra nút Stop có đang hiện không
    function isStopButtonVisible(doc) {
        const stopBtn = doc.querySelector('button[data-tooltip-id="input-send-button-stop-tooltip"]');
        if (stopBtn && stopBtn.offsetParent !== null) return true;
        const btns = doc.querySelectorAll('button');
        for (const btn of btns) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            const tooltip = (btn.getAttribute('data-tooltip-id') || '').toLowerCase();
            if ((label.includes('stop') || tooltip.includes('stop')) && btn.offsetParent !== null) {
                return true;
            }
        }
        return false;
        return false;
    }

    // ========== COMMAND HANDLING ==========
    async function sendTelegramMessage(text) {
        try {
            await fetch(`https://api.telegram.org/bot${CONFIG.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: CONFIG.chatId, text: text })
            });
            console.log(`📤 Bot reply: ${text}`);
        } catch (e) {
            console.error("📡 Telegram error:", e.message);
        }
    }

    function handleCommand(text) {
        const cmd = text.trim().toLowerCase();

        if (cmd === '/chat on') {
            isChatActive = true;
            sendTelegramMessage("✅ Đã BẬT tính năng chat với Agent.");
        }
        else if (cmd === '/chat off') {
            isChatActive = false;
            sendTelegramMessage("⛔ Chức năng chat từ xa với Agent đã tạm dừng.");
        }
        else if (cmd === '/list') {
            sendTelegramMessage(COMMANDS_HELP);
        }
        else {
            sendTelegramMessage("❓ Lệnh không hợp lệ. Gõ /list để xem hướng dẫn.");
        }
    }

    // ========== POLLING (Recursive Long Poll - phản hồi tức thì) ==========
    function startPolling() {
        if (pollIsRunning) return;
        pollIsRunning = true;
        console.log("🔄 Polling started (recursive long poll, timeout=30s).");
        poll();
    }

    async function poll() {
        // Nếu đang chờ Agent trả lời, chờ 2s rồi thử lại
        if (isWaitingForAgent) {
            setTimeout(poll, 500);
            return;
        }

        try {
            const res = await fetch(
                `https://api.telegram.org/bot${CONFIG.token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
            );
            const data = await res.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.chat.id == CONFIG.chatId) {
                        // Chỉ dedupe theo update_id để không làm mất lệnh retry cùng text
                        if (update.update_id <= lastHandledUpdateId) continue;
                        const text = update.message.text;
                        if (!text) continue;
                        lastHandledUpdateId = update.update_id;

                        // 1. INTERCEPT COMMANDS
                        if (text.trim().startsWith('/')) {
                            console.log("🎮 Command received:", text);
                            handleCommand(text);
                            setTimeout(poll, 100);
                            return;
                        }

                        // 2. CHECK CHAT ACTIVE
                        if (!isChatActive) {
                            console.log("🔒 Chat is OFF. Replying to user.");
                            sendTelegramMessage("Bot chat đang ở trạng thái dừng, hãy dùng lệnh \"/chat on\" để mở lại");
                            setTimeout(poll, 100);
                            return;
                        }

                        console.log("📥 Receiving task:", text);
                        handleTask(text);
                        // Sau khi xử lý, tiếp tục poll (isWaitingForAgent sẽ = true)
                        setTimeout(poll, 100);
                        return;
                    }
                }
            }
        } catch (e) {
            console.error("📡 Poll error:", e.message);
        }

        // Gọi lại ngay (không delay) để tiếp tục long poll
        setTimeout(poll, 100);
    }

    // ========== HANDLE TASK ==========
    function handleTask(text) {
        const doc = getAgentDoc();
        if (!doc) {
            console.log("❌ Không tìm thấy agent panel");
            return;
        }

        const input = doc.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
        if (!input) {
            console.log("❌ Không tìm thấy ô input");
            return;
        }

        // Đánh dấu bận ngay lập tức
        isWaitingForAgent = true;

        // 1. Gửi ngay tin nhắn trạng thái "Đang xử lý"
        streamState = {
            messageIds: [],
            lastFullText: "Agent đang xử lý...",
            lastSendTime: Date.now(),
            pendingSend: false
        };
        updateTelegram(streamState.lastFullText);

        // 2. Điền text và gửi
        input.focus();
        input.innerText = text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));

        setTimeout(() => {
            const sendBtn = doc.querySelector('button[data-tooltip-id="input-send-button-send-tooltip"]');
            if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
                console.log("✅ Đã click gửi");
            } else {
                input.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                }));
                console.log("✅ Đã nhấn Enter");
            }

            // Theo dõi response
            const msgs = doc.querySelectorAll('div.prose.prose-sm');
            const baselineCount = msgs.length;
            const baselineText = baselineCount > 0 ? msgs[baselineCount - 1].innerText : "";

            // Ko reset messageIds để edit lại tin nhắn "Đang xử lý"
            streamState.lastFullText = baselineText;
            startContentObserver(doc, baselineText, baselineCount);
        }, 300);
    }

    // ========== TELEGRAM MESSAGE HELPERS ==========
    function splitMessage(text, chunkSize = 4000) {
        if (!text) return [""];
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.substring(i, i + chunkSize));
        }
        return chunks.length > 0 ? chunks : [""];
    }

    function updateTelegram(fullText) {
        if (!fullText) return Promise.resolve();
        telegramUpdateQueue = telegramUpdateQueue
            .then(() => updateTelegramNow(fullText))
            .catch((e) => console.error("📡 Lỗi hàng đợi Telegram:", e?.message || e));
        return telegramUpdateQueue;
    }

    async function updateTelegramNow(fullText) {
        if (!fullText) return;
        const chunks = splitMessage(fullText);

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            const messageId = streamState.messageIds[i];

            try {
                if (!messageId) {
                    const res = await fetch(`https://api.telegram.org/bot${CONFIG.token}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: CONFIG.chatId, text: chunkText })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        streamState.messageIds[i] = data.result.message_id;
                        console.log(`📤 Gửi tin mới phần ${i + 1}`);
                    }
                } else {
                    await fetch(`https://api.telegram.org/bot${CONFIG.token}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: CONFIG.chatId, message_id: messageId, text: chunkText })
                    });
                }
            } catch (e) {
                console.error(`📡 Lỗi Telegram phần ${i + 1}:`, e.message);
            }
        }
    }

    // Global allow stopping the previous stream manually
    let stopCurrentStream = null;

    // ========== CONTENT OBSERVER (MutationObserver + Fallback + Throttle) ==========
    function startContentObserver(doc, baselineText, baselineCount) {
        // Stop previous stream if running
        if (stopCurrentStream) {
            console.log("🛑 Dừng stream cũ để bắt đầu stream mới.");
            stopCurrentStream();
        }

        streamRound++;
        const round = streamRound;
        console.log(`👀 [Round ${round}] Bắt đầu theo dõi nội dung (baseline: ${baselineText.length} chars)...`);

        let lastChangeTime = Date.now();
        let checkInterval = null;
        let observer = null;
        let foundNewMessage = false;
        let finished = false;

        // Hàm cleanup thực sự
        const cleanup = () => {
            if (finished) return;
            finished = true;
            clearInterval(checkInterval);
            if (observer) { try { observer.disconnect(); } catch (e) { } }
            stopCurrentStream = null; // Reset global stopper
        };

        // Gán vào global để handleTask có thể gọi nếu cần (mặc dù ở đây là tự gọi)
        // Thực tế handleTask nên gọi stopCurrentStream() _trước khi_ gọi startContentObserver
        // Nhưng startContentObserver tự lo cũng được. 
        // Tuy nhiên logic đúng là handleTask gọi.
        stopCurrentStream = cleanup;


        const onContentChange = () => {
            const msgs = doc.querySelectorAll('div.prose.prose-sm');
            if (msgs.length === 0) return;

            const currentCount = msgs.length;
            const text = msgs[currentCount - 1].innerText;
            if (!text) return;

            // Phát hiện response mới: 
            // 1. Số lượng message tăng lên (đã sang câu trả lời mới)
            // 2. HOẶC text của block cuối cùng thay đổi so với baseline
            if (!foundNewMessage && (currentCount > baselineCount || (text.trim().length > 0 && text !== baselineText))) {
                console.log(`🎉 [Round ${round}] Phát hiện response mới!`);
                foundNewMessage = true;
            }

            // Chỉ xử lý nếu đã tìm thấy tin mới VÀ nội dung thay đổi
            if (!foundNewMessage || text === streamState.lastFullText) return;

            lastChangeTime = Date.now();
            streamState.lastFullText = text;
            streamState.pendingSend = true;

            const now = Date.now();
            if (now - streamState.lastSendTime >= STREAM_CONFIG.THROTTLE_MS) {
                streamState.lastSendTime = now;
                streamState.pendingSend = false;
                updateTelegram(text);
            }
        };

        // 1. MutationObserver
        try {
            observer = new MutationObserver(() => onContentChange());
            observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
            console.log(`✅ [Round ${round}] Observer gắn thành công.`);
        } catch (e) {
            console.error("❌ Observer error:", e);
        }

        // 2. Interval: Fallback + Throttle Flush (NO AUTO FINISH)
        checkInterval = setInterval(async () => {
            if (finished) return;
            const now = Date.now();

            // Fallback polling
            onContentChange();

            // Throttle flush: gửi text đang chờ
            if (foundNewMessage && streamState.pendingSend && (now - streamState.lastSendTime >= STREAM_CONFIG.THROTTLE_MS)) {
                streamState.lastSendTime = now;
                streamState.pendingSend = false;
                await updateTelegram(streamState.lastFullText);
            }

            // CHECK EXIT CONDITION: Nếu Agent đã xong việc -> mở khóa cho tin nhắn mới
            const busyStat = isAgentBusy(doc);
            if (!busyStat.busy && isWaitingForAgent) {
                isWaitingForAgent = false;
                console.log("🔓 Agent đã xong việc. Mở khóa polling.");
            }

            // AUTO-CLICK RUN BUTTONS
            clickRunButtons(doc);

            // === REMOVED AUTO FINISH LOGIC ===
            // Chúng ta KHÔNG BAO GIỜ tự động finishStream dựa trên idle time hay status.
            // Stream chỉ kết thúc khi hàm cleanup() được gọi (tức là khi có message mới từ handleTask).

        }, 500);
    }

    // ========== AUTO-RUN HELPER ==========
    function clickRunButtons(doc) {
        // Scan TOÀN BỘ button trong document thay vì chỉ trong lastMsg
        const buttons = doc.querySelectorAll('button');

        for (const btn of buttons) {
            // Bỏ qua nếu đã click
            if (btn.hasAttribute('data-auto-clicked')) continue;

            const text = (btn.innerText || '').trim().toLowerCase();
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            const title = (btn.getAttribute('title') || '').toLowerCase();

            // Mở rộng điều kiện nhận diện: CHỈ kích nếu BẮT ĐẦU bằng "run"
            const isRun =
                text.startsWith('Run') ||
                label.startsWith('Run') ||
                title.startsWith('Run');

            if (isRun) {
                console.log(`🎯 Tìm thấy nút RUN tiềm năng: Text="${text}", Label="${label}", Title="${title}", Disabled=${btn.disabled}`);

                if (!btn.disabled) {
                    console.log("▶️ Đang click nút RUN...");
                    btn.click();
                    btn.setAttribute('data-auto-clicked', 'true');
                } else {
                    console.log("⏳ Nút RUN đang bị disabled, chờ...");
                }
            }
        }
    }

    console.log("🚀 BRIDGE V13.0 (PROACTIVE STATUS MSG) IS READY.");
    startPolling();
})();
