(function() {
    // 1. Inject CSS
    const styles = `
    .chatbot-trigger {
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 65px;
        height: 65px;
        background: linear-gradient(135deg, var(--primary, #2563eb) 0%, var(--secondary, #6366f1) 100%);
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        color: white;
        font-size: 28px;
        box-shadow: 0 10px 25px rgba(37, 99, 235, 0.4);
        cursor: pointer;
        z-index: 1000;
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .chatbot-trigger:hover {
        transform: scale(1.1) rotate(5deg);
    }
    .chat-window {
        display: none;
        position: fixed;
        bottom: 110px;
        right: 30px;
        width: 320px;
        height: 450px;
        background: white;
        border-radius: 24px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(0,0,0,0.05);
    }
    .chat-header {
        background: linear-gradient(135deg, var(--primary, #2563eb) 0%, var(--secondary, #6366f1) 100%);
        padding: 20px;
        color: white;
        display: flex;
        align-items: center;
        gap: 15px;
        cursor: grab;
    }
    .chat-header:active {
        cursor: grabbing;
    }
    .chat-messages {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #f8fafc;
    }
    .msg {
        max-width: 80%;
        padding: 12px 16px;
        border-radius: 18px;
        font-size: 14px;
        line-height: 1.5;
    }
    .msg-bot {
        background: white;
        color: var(--text-main, #0f172a);
        align-self: flex-start;
        border-bottom-left-radius: 4px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.02);
    }
    .msg-user {
        background: var(--primary, #2563eb);
        color: white;
        align-self: flex-end;
        border-bottom-right-radius: 4px;
    }
    .chat-input-area {
        padding: 20px;
        display: flex;
        gap: 10px;
        border-top: 1px solid #f1f5f9;
        background: white;
    }
    .chat-input {
        flex: 1;
        border: 1px solid #e2e8f0;
        padding: 10px 15px;
        border-radius: 12px;
        outline: none;
        font-size: 14px;
    }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // 2. Inject HTML
    const chatbotHTML = `
    <div class="chatbot-trigger" id="chatbotTrigger" title="Chat with AI" style="bottom: 30px; right: 30px; top: auto; left: auto;">💬</div>
    <div class="chat-window" id="chatWindow" style="bottom: 110px; right: 30px; top: auto; left: auto;">
        <div class="chat-header" id="chatHeader">
            <span>🤖 AI Support</span>
            <button id="chatbotCloseBtn" style="background:none;border:none;color:white;cursor:pointer;margin-left:auto;font-size:24px;line-height:1;">&times;</button>
        </div>
        <div class="chat-messages" id="chatMessages">
            <div class="msg msg-bot">Hello! I'm your AI election assistant. How can I help you today?</div>
        </div>
        <div class="chat-input-area">
            <input type="text" id="chatInput" class="chat-input" placeholder="Ask a question...">
            <button id="chatSendBtn" style="background:var(--primary, #2563eb);color:white;border:none;border-radius:12px;padding:0 15px;cursor:pointer;font-weight:600;">Send</button>
        </div>
    </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = chatbotHTML;
    document.body.appendChild(container);

    // 3. Logic & Event Listeners
    const trigger = document.getElementById('chatbotTrigger');
    const win = document.getElementById('chatWindow');
    const header = document.getElementById('chatHeader');
    const closeBtn = document.getElementById('chatbotCloseBtn');
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const msgs = document.getElementById('chatMessages');

    let isDraggingTrigger = false;

    function toggleChat() {
        if (isDraggingTrigger) return;
        const isOpen = win.style.display === 'flex';
        if (isOpen) {
            win.style.display = 'none';
            trigger.innerHTML = '💬';
        } else {
            win.style.display = 'flex';
            trigger.innerHTML = '&times;';
            input.focus();
        }
    }

    trigger.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        win.style.display = 'none';
        trigger.innerHTML = '💬';
    });

    function sendChatMessage() {
        const query = input.value.trim();
        if(!query) return;

        // Add user message
        const userDiv = document.createElement('div');
        userDiv.className = 'msg msg-user';
        userDiv.innerText = query;
        msgs.appendChild(userDiv);
        input.value = '';
        msgs.scrollTop = msgs.scrollHeight;

        // Better Bot Response Logic using Knowledge Base
        setTimeout(() => {
            const botDiv = document.createElement('div');
            botDiv.className = 'msg msg-bot';
            
            const q = query.toLowerCase();
            let response = "I'm not exactly sure about that. If you need further assistance, please visit our <a href='complaints' style='color:var(--primary); font-weight:bold;'>Helpdesk</a> to submit a ticket.";
            
            // Knowledge Base Definitions
            const faqs = [
                {
                    keywords: ['hello', 'hi', 'hey', 'start', 'help'],
                    answer: "Hello! I'm your AI Election Assistant. You can ask me about registering, voting, candidates, results, or how to lodge a complaint."
                },
                {
                    keywords: ['register', 'registration', 'sign up', 'create account', 'eligible'],
                    answer: "To register, go to the Homepage and click 'Get Started' under Voter Registration. You'll need your institutional email, department, and a facial scan for biometric security."
                },
                {
                    keywords: ['vote', 'voting', 'how to vote', 'cast', 'ballot'],
                    answer: "To vote, navigate to the <b>Ballot Box</b> section from the sidebar or homepage. You will verify your biometric data through your camera and then select your preferred candidates."
                },
                {
                    keywords: ['time', 'when', 'deadline', 'close', 'open', 'schedule'],
                    answer: "Voting schedules are displayed on your Dashboard countdown. Make sure to cast your vote before the timer hits zero!"
                },
                {
                    keywords: ['candidate', 'who is running', 'nominee', 'leaders'],
                    answer: "You can view all approved candidates in the 'Current Candidates' section on your Dashboard or see full details on the Voting page."
                },
                {
                    keywords: ['apply', 'become candidate', 'nominate', 'run for'],
                    answer: "To become a candidate, log in and go to the <b>Candidate Portal</b> via the sidebar. Fill out the application, submit your manifesto, and wait for Committee approval."
                },
                {
                    keywords: ['result', 'winner', 'who won', 'stats'],
                    answer: "Live and final results are available on the <b>Live Results</b> page. Results are usually published shortly after the polls officially close."
                },
                {
                    keywords: ['complain', 'complaint', 'helpdesk', 'issue', 'error', 'appeal', 'rejected'],
                    answer: "If you have an issue (like a rejected application or a technical error), please visit the <a href='complaints' style='color:var(--primary); font-weight:bold;'>Helpdesk</a> to lodge a grievance. You can track your ticket there too."
                },
                {
                    keywords: ['thank', 'thanks', 'appreciate', 'ok', 'okay', 'good'],
                    answer: "You're very welcome! Happy voting!"
                }
            ];

            // Matching Logic
            let maxMatches = 0;
            let bestAnswer = "";

            faqs.forEach(faq => {
                let matches = 0;
                faq.keywords.forEach(keyword => {
                    if (q.includes(keyword)) {
                        matches++;
                    }
                });
                
                if (matches > maxMatches) {
                    maxMatches = matches;
                    bestAnswer = faq.answer;
                }
            });

            if (bestAnswer) {
                response = bestAnswer;
            }

            botDiv.innerHTML = response;
            msgs.appendChild(botDiv);
            msgs.scrollTop = msgs.scrollHeight;
        }, 800);
    }

    sendBtn.addEventListener('click', sendChatMessage);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // 4. Dragging Logic
    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        let isMoving = false;
        
        const dragHandle = handle || element;
        
        dragHandle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            // ONLY stop default if dragging the handle so inputs inside still work
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                e.preventDefault();
            }
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            isMoving = false;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            isMoving = true;
            if (element === trigger) isDraggingTrigger = true;
            
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.bottom = "auto";
            element.style.right = "auto";
        }

        function closeDragElement(e) {
            document.onmouseup = null;
            document.onmousemove = null;
            
            // Allow click event to fire if it wasn't a drag
            setTimeout(() => {
                if (element === trigger) isDraggingTrigger = false;
            }, 50);
        }
    }

    makeDraggable(trigger);
    makeDraggable(win, header);

})();
