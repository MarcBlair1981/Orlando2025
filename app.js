// --- GLOBAL CONFIGURATION ---
console.log("App.js script loaded");

// 1. INTERNAL PREVIEW CONFIG
const internalConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const internalAppId = typeof __app_id !== 'undefined' ? __app_id : null;
const internalAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// 2. EXTERNAL DEPLOYMENT CONFIG
const externalConfig = window.GIT_FIREBASE_CONFIG || {};

let firebaseConfig;
let appId;
let isInternalEnv = false;

if (internalConfig) {
    firebaseConfig = internalConfig;
    appId = internalAppId || 'default-app-id';
    isInternalEnv = true;
} else {
    firebaseConfig = externalConfig;
    if (firebaseConfig.apiKey) {
        appId = firebaseConfig.projectId || "orlando-trip-app-prod";
    } else {
        appId = "orlando-trip-app-prod";
    }
    isInternalEnv = false;
}

let app;
let db;
let auth;
let userId = 'loading';
let isAuthReady = false;

const FAMILY_MEMBERS = [
    { id: "Marc", name: "Marc Blair", age: 43, role: 'adult' },
    { id: "Melissa", name: "Melissa Blair", age: 39, role: 'adult' },
    { id: "Billie", name: "Billie Blair", age: 10, role: 'child' },
    { id: "Mimi", name: "Mimi Blair", age: 6, role: 'child' },
    { id: "Daniel", name: "Daniel Rosenberg", age: 39, role: 'adult' },
    { id: "Jessica", name: "Jessica Blair", age: 37, role: 'adult' },
    { id: "Joey", name: "Joey Rosenberg", age: 5, role: 'child' },
    { id: "Emma", name: "Emma Rosenberg", age: 7, role: 'child' },
    { id: "Riley", name: "Riley Rosenberg", age: 1, role: 'child' },
    { id: "John", name: "John Blair", age: 71, role: 'adult' },
    { id: "Lindsay", name: "Lindsay Blair", age: 70, role: 'adult' },
    { id: "Ricky", name: "Ricky Blair", age: 41, role: 'adult' },
];

// --- SECURITY CONFIG ---
const SECURITY_QUESTION = "Collective Term for Joey & Emma?";
const SECURITY_ANSWER = "vermin"; // Case-insensitive

const ITINERARY_COLLECTION_PATH = `artifacts/${appId}/public/data/orlando_planning_itinerary_items`;

const PACKING_COLLECTION_PATH = `artifacts/${appId}/public/data/orlando_planning_packing_list`;
const PHOTO_COLLECTION_PATH = `artifacts/${appId}/public/data/orlando_planning_photos`;

// --- UI UTILITIES ---
// Explicitly attach to window to ensure global availability
window.showTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));

    const tab = document.getElementById(`tab-${tabId}`);
    const btn = document.querySelector(`.tab-button[data-tab="${tabId}"]`);

    if (tab) tab.classList.remove('hidden');
    if (btn) btn.classList.add('active');
}

// --- AUTHENTICATION & INITIALIZATION ---

function initializeFirebase() {
    document.getElementById('app-load-status').textContent = "Firebase initialization starting...";

    if (!firebaseConfig || !firebaseConfig.apiKey) {
        console.error("Firebase config is missing or incomplete.");
        document.getElementById('auth-status').textContent = "⚠️ OFFLINE: Firebase keys missing!";
        document.getElementById('auth-status').className = "text-sm text-red-600 font-bold";
        return;
    }

    try {
        // COMPAT SYNTAX: firebase.initializeApp
        if (!firebase.apps.length) {
            app = firebase.initializeApp(firebaseConfig);
        } else {
            app = firebase.app();
        }

        db = firebase.firestore();
        auth = firebase.auth();

        document.getElementById('app-load-status').textContent = "Firebase services initialized. Waiting for Auth...";
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        document.getElementById('app-load-status').textContent = "Init Error: " + error.message;
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            userId = user.uid;
            document.getElementById('current-user-id').textContent = userId;
            document.getElementById('auth-status').textContent = isInternalEnv ? `Online (Internal)` : `Online (External)`;
            document.getElementById('app-load-status').textContent = "Authentication successful.";

            isAuthReady = true;
            const addBtn = document.getElementById('add-item-button');
            if (addBtn) addBtn.disabled = false;

            const statusMsg = document.getElementById('add-item-status');
            if (statusMsg) statusMsg.classList.add('hidden');

            setupRealtimeListeners();

            // Don't await these - let them run in background to avoid blocking UI
            initializeItinerary();
            initializePackingList();

            setupResizableColumns();
            setupDragAndDrop();

            // NEW: Check Login Status
            checkLoginStatus();
        } else {
            if (isInternalEnv && internalAuthToken) {
                auth.signInWithCustomToken(internalAuthToken).catch(err => console.error("Token Auth Fail", err));
            } else {
                try {
                    await auth.signInAnonymously();
                    const statusMsg = document.getElementById('add-item-status');
                    if (statusMsg) statusMsg.classList.remove('hidden');
                } catch (error) {
                    console.error("Firebase Auth failed:", error);
                }
            }
        }
    });
}

// --- LOGIN & IDENTITY LOGIC ---
let currentUserMemberId = null;
let currentUserIsAdult = false;

function checkLoginStatus() {
    const storedUser = localStorage.getItem('orlandoUser2026');
    const storedIsAdult = localStorage.getItem('orlandoUserIsAdult2026') === 'true';

    if (storedUser) {
        // Restore session without prompting if it exists
        currentUserMemberId = storedUser;
        currentUserIsAdult = storedIsAdult;
        updateUIForUser(storedUser);
    } else {
        renderLoginButtons();
        document.getElementById('login-modal').classList.remove('hidden');
    }
}

function renderLoginButtons() {
    const grid = document.getElementById('login-grid');
    if (!grid) return;
    grid.innerHTML = '';

    FAMILY_MEMBERS.forEach(member => {
        const btn = document.createElement('button');
        btn.className = "login-btn bg-red-50 hover:bg-red-100 border-2 border-red-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2 transition-all";
        btn.onclick = () => loginAs(member.id, true);

        // Simple avatar based on age/gender guess (could be improved)
        const emoji = member.age < 12 ? '👶' : (member.name.includes('John') || member.name.includes('Ricky') || member.name.includes('Marc') || member.name.includes('Daniel')) ? '👨' : '👩';

        btn.innerHTML = `
            <span class="text-4xl">${emoji}</span>
            <span class="font-bold text-gray-800">${member.name.split(' ')[0]}</span>
        `;
        grid.appendChild(btn);
    });
}

window.loginAs = function (memberId, save = true) {
    const member = FAMILY_MEMBERS.find(m => m.id === memberId);
    if (!member) return;

    // Global Security Check for EVERYONE
    const inputAnswer = prompt(SECURITY_QUESTION);
    if (!inputAnswer || inputAnswer.trim().toLowerCase() !== SECURITY_ANSWER.toLowerCase()) {
        alert("Incorrect answer. Access denied.");
        return;
    }

    const isAdult = (member.role === 'adult');

    currentUserMemberId = memberId;
    currentUserIsAdult = isAdult;

    if (save) {
        localStorage.setItem('orlandoUser2026', memberId);
        localStorage.setItem('orlandoUserIsAdult2026', isAdult);
        document.getElementById('login-modal').classList.add('hidden');
    }

    updateUIForUser(memberId);
}

function updateUIForUser(memberId) {
    // Update Dashboard Greeting
    const welcomeHeader = document.querySelector('#tab-dashboard h2');
    if (welcomeHeader) {
        const member = FAMILY_MEMBERS.find(m => m.id === memberId);
        if (member) welcomeHeader.textContent = `Welcome, ${member.name.split(' ')[0]}! 👋`;
    }

    // Re-render things that depend on identity
    if (window.currentItineraryItems) renderItinerary(window.currentItineraryItems);

    // Re-render packing list to show/hide controls based on adult status
    if (window.currentPackingItems) renderPackingList(window.currentPackingItems);
}

// --- COUNTDOWN LOGIC ---
function startCountdown() {
    const tripDate = new Date("2025-12-20T12:00:00Z").getTime();

    function update() {
        const now = new Date().getTime();
        const distance = now - tripDate;

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        document.getElementById("cd-days").innerText = days;
        document.getElementById("cd-hours").innerText = hours;
        document.getElementById("cd-minutes").innerText = minutes;
        document.getElementById("cd-seconds").innerText = seconds;
    }

    setInterval(update, 1000);
    update(); // Initial call
}

// --- FIRESTORE LISTENERS ---

function setupRealtimeListeners() {
    if (!db) return;

    // COMPAT SYNTAX: db.collection()
    db.collection(ITINERARY_COLLECTION_PATH).onSnapshot((snapshot) => {
        const items = snapshot.docs.map(d => ({
            ...d.data(),
            id: d.id
        }));
        renderItinerary(items);
        document.getElementById('app-load-status').textContent = "Itinerary updated.";
    }, (error) => {
        console.error("Itinerary snapshot error:", error);
    });



    db.collection(PACKING_COLLECTION_PATH).onSnapshot((snapshot) => {
        const packingItems = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
        renderPackingList(packingItems);
    });

    db.collection(PHOTO_COLLECTION_PATH).orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
        const photos = snapshot.docs.map(d => d.data());
        renderGallery(photos);
    });
}

// --- PACKING LIST LOGIC ---

window.currentPackingItems = [];

async function initializePackingList() {
    if (!db) return;
    const collectionRef = db.collection(PACKING_COLLECTION_PATH);

    try {
        const snapshot = await collectionRef.get();
        if (snapshot.empty) {
            const initialItems = [
                { personId: "Marc", item: "Passport", checked: false },
                { personId: "Marc", item: "Golf Clubs", checked: false },
                { personId: "Melissa", item: "Sunscreen", checked: false },
                { personId: "Melissa", item: "Mickey Ears", checked: true },
                { personId: "Billie", item: "iPad & Charger", checked: false },
                { personId: "Mimi", item: "Princess Dress", checked: false },
                { personId: "Riley", item: "Stroller Fan", checked: false },
                { personId: "Riley", item: "Diapers", checked: false },
            ];

            // Use Promise.all for parallel addition
            const batchPromises = initialItems.map(item => collectionRef.add(item));
            await Promise.all(batchPromises);
            console.log("Initialized packing list with default items.");
        }
    } catch (e) {
        console.error("Error initializing packing list:", e);
    }
}

function renderPackingList(items) {
    window.currentPackingItems = items; // Store for re-rendering
    const container = document.getElementById('packing-list-container');
    if (!container) return;
    container.innerHTML = '';

    // Group items by person
    const grouped = {};
    FAMILY_MEMBERS.forEach(member => {
        grouped[member.id] = { name: member.name, items: [] };
    });

    items.forEach(item => {
        if (grouped[item.personId]) {
            grouped[item.personId].items.push(item);
        }
    });

    Object.keys(grouped).forEach(personId => {
        const group = grouped[personId];
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl shadow-md border border-gray-200 p-4 flex flex-col h-full';

        const header = document.createElement('div');
        header.className = 'flex items-center justify-between mb-3 border-b pb-2';
        header.innerHTML = `<h3 class="font-bold text-lg text-gray-800">${group.name}</h3>`;
        card.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'flex-grow space-y-2 mb-4 overflow-y-auto max-h-60';

        if (group.items.length === 0) {
            list.innerHTML = '<li class="text-sm text-gray-400 italic">Nothing added yet.</li>';
        } else {
            group.items.sort((a, b) => a.item.localeCompare(b.item)); // Sort alphabetically
            group.items.forEach(item => {
                const li = document.createElement('li');
                li.className = 'flex items-center justify-between group';

                // Only allow toggling if adult
                const checkboxDisabled = !currentUserIsAdult ? 'disabled' : '';
                const cursorClass = currentUserIsAdult ? 'cursor-pointer' : 'cursor-not-allowed';

                li.innerHTML = `
                    <label class="flex items-center ${cursorClass} flex-grow">
                        <input type="checkbox" class="form-checkbox h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500 transition duration-150 ease-in-out" 
                            ${item.checked ? 'checked' : ''} 
                            ${checkboxDisabled}
                            onchange="togglePackingItem('${item.id}', ${!item.checked})">
                        <span class="ml-2 text-sm ${item.checked ? 'line-through text-gray-400' : 'text-gray-700'}">${item.item}</span>
                    </label>
                    ${currentUserIsAdult ? `
                    <button onclick="deletePackingItem('${item.id}')" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity px-2">
                        &times;
                    </button>
                    ` : ''}
                `;
                list.appendChild(li);
            });
        }
        card.appendChild(list);

        // Add Item Input - ONLY FOR ADULTS
        if (currentUserIsAdult) {
            const inputGroup = document.createElement('div');
            inputGroup.className = 'mt-auto pt-2 flex';
            inputGroup.innerHTML = `
                <input type="text" id="add-pack-${personId}" placeholder="Add item..." 
                    class="flex-grow text-sm border border-gray-300 rounded-l-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-500"
                    onkeydown="if(event.key==='Enter') addPackingItem('${personId}')">
                <button onclick="addPackingItem('${personId}')" class="bg-red-100 hover:bg-red-200 text-red-700 text-sm font-semibold px-3 py-1 rounded-r-md transition">
                    +
                </button>
            `;
            card.appendChild(inputGroup);
        }

        container.appendChild(card);
    });

    // Auto-scroll to current user
    if (currentUserMemberId) {
        setTimeout(() => {
            const userCardHeader = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes(currentUserMemberId));
            if (userCardHeader) {
                userCardHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
                userCardHeader.parentElement.parentElement.classList.add('ring-4', 'ring-yellow-400'); // Highlight card
            }
        }, 500);
    }
}

window.addPackingItem = async function (personId) {
    if (!db) return;
    if (!currentUserIsAdult) {
        alert("Only adults can add items.");
        return;
    }
    const input = document.getElementById(`add-pack-${personId}`);
    const val = input.value.trim();
    if (!val) return;

    try {
        await db.collection(PACKING_COLLECTION_PATH).add({
            personId: personId,
            item: val,
            checked: false
        });
        input.value = '';
    } catch (e) {
        console.error("Error adding packing item:", e);
    }
}

window.togglePackingItem = async function (itemId, checked) {
    if (!db) return;
    if (!currentUserIsAdult) {
        // Should be prevented by UI, but good safety check
        console.warn("Blocked unauthorized toggle attempt");
        // Re-render to revert checkbox state visually if it changed
        renderPackingList(window.currentPackingItems);
        return;
    }
    try {
        await db.collection(PACKING_COLLECTION_PATH).doc(itemId).update({ checked: checked });
    } catch (e) {
        console.error("Error toggling item:", e);
    }
}

window.deletePackingItem = async function (itemId) {
    if (!db) return;
    if (!currentUserIsAdult) return;

    if (!confirm("Remove this item?")) return;
    try {
        await db.collection(PACKING_COLLECTION_PATH).doc(itemId).delete();
    } catch (e) {
        console.error("Error deleting item:", e);
    }
}

// --- ITINERARY LOGIC ---

window.currentItineraryItems = [];

function getPrimarySortValue(dateString) {
    if (!dateString || typeof dateString !== 'string' || dateString.toUpperCase() === 'TBC') {
        return 9999.0;
    }

    const dateMap = {
        "Dec 18": 1218, "Dec 19": 1219,
        "Dec 20": 1220, "Dec 21": 1221, "Dec 22": 1222, "Dec 23": 1223,
        "Dec 24": 1224, "Dec 25": 1225, "Dec 26": 1226, "Dec 27": 1227,
        "Dec 28": 1228, "Dec 29": 1229, "Dec 30": 1230, "Dec 31": 1231,
        "Jan 1": 101, "Jan 2": 102
    };

    const datePartMatch = dateString.match(/^(Dec \d{1,2}|Jan \d{1,2})/);
    const key = datePartMatch ? datePartMatch[1].trim() : '';

    return dateMap[key] || 9999.0;
}

async function initializeItinerary() {
    if (!db) return;
    const collectionRef = db.collection(ITINERARY_COLLECTION_PATH);
    const snapshot = await collectionRef.get();

    if (snapshot.docs.filter(d => d.data().date !== 'TBC').length === 0) {
        const initialItinerary = [
            createItineraryItem("Dec 22 (Arrival)", "Arrivals / Check-in (after 3PM)", "Booked", "Marc, Melissa, John, Lindsay, Ricky", 1),
            createItineraryItem("Dec 23", "Magic Kingdom Day (Lunch at Be Our Guest)", "Planned", "All", 1),
            createItineraryItem("Dec 23", "Epcot Holiday Festival", "Planned", "Marc, Melissa, Daniel, Jessica, Ricky, John, Lindsay", 2),
            createItineraryItem("TBC", "Try the new Star Wars ride at Hollywood Studios", "Idea", "Daniel, Ricky", 1),
            createItineraryItem("TBC", "Golf Day for the adults", "Idea", "Marc, Daniel, John, Ricky", 2),
        ];
        for (const item of initialItinerary) {
            await collectionRef.add(item);
        }
    }
}

function createItineraryItem(date, activity, status, attendeesText, timeOrder = 0) {
    const attendees = {};
    const isAll = attendeesText.toLowerCase().includes('all') || attendeesText.toLowerCase().includes('everyone');

    FAMILY_MEMBERS.forEach(member => {
        if (isAll) {
            attendees[member.id] = 'Y';
        } else {
            const firstName = member.name.split(' ')[0].toLowerCase();
            const mentioned = attendeesText.split(',').some(name =>
                name.trim().toLowerCase().includes(member.id.toLowerCase()) ||
                name.trim().toLowerCase().includes(firstName)
            );
            attendees[member.id] = mentioned ? 'Y' : 'N';
        }
    });

    return {
        date: date,
        activity: activity,
        status: status,
        attendees: attendees,
        cost: 0,
        timeOrder: timeOrder,
    };
}

function renderItinerary(items) {
    const tableBody = document.getElementById('itinerary-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    window.currentItineraryItems = items;

    const groupedItems = {};
    items.forEach(item => {
        const primarySortValue = getPrimarySortValue(item.date);
        if (!groupedItems[primarySortValue]) {
            groupedItems[primarySortValue] = {
                name: item.date === 'TBC' ? 'TBC / Future Ideas' : item.date.match(/^(Dec \d{1,2}|Jan \d{1,2})/)?.[0] || 'Unknown Date',
                items: []
            };
        }
        groupedItems[primarySortValue].items.push(item);
    });

    const sortedGroupKeys = Object.keys(groupedItems).sort((a, b) => parseFloat(a) - parseFloat(b));
    const editableFields = ['date', 'activity', 'status'];
    const colspan = editableFields.length + FAMILY_MEMBERS.length;

    sortedGroupKeys.forEach(groupKey => {
        const group = groupedItems[groupKey];
        group.items.sort((a, b) => (a.timeOrder || 0) - (b.timeOrder || 0));

        const headerRow = tableBody.insertRow();
        headerRow.className = 'bg-gray-200 border-b-4 border-red-500 sticky top-0 z-5';
        const headerCell = headerRow.insertCell();
        headerCell.colSpan = colspan;
        headerCell.className = 'p-3 text-left font-extrabold text-xl text-red-800 tracking-wide shadow-inner group-header-cell'; // Added class
        headerCell.textContent = group.name;
        headerCell.dataset.groupKey = groupKey;
        headerCell.dataset.groupName = group.name;

        group.items.forEach((item) => {
            const row = tableBody.insertRow();
            row.className = 'border-t hover:bg-red-50 transition duration-100 draggable-row';
            row.setAttribute('draggable', 'true');
            row.dataset.id = item.id;
            row.dataset.order = item.timeOrder || 0;
            row.dataset.groupKey = groupKey;

            editableFields.forEach((field) => {
                const cell = row.insertCell();
                let cellContent = item[field] || '';

                if (field === 'date') {
                    cell.classList.add('font-semibold', 'relative', 'whitespace-nowrap');
                    cell.dataset.groupKey = groupKey;

                    // ALWAYS allow editing, even for TBC
                    cell.addEventListener('click', (e) => handleDateCellClick(e, item.id));
                    cell.setAttribute('contenteditable', 'false');
                    cell.textContent = cellContent;

                    if (group.name === 'TBC / Future Ideas') {
                        cell.classList.add('bg-gray-100');
                    }
                } else {
                    cell.className += ' spreadsheet-cell text-sm whitespace-nowrap';
                    cell.setAttribute('contenteditable', 'true');
                    cell.dataset.id = item.id;
                    cell.dataset.field = field;
                    cell.textContent = cellContent;
                    cell.addEventListener('blur', handleCellEdit);
                }
            });

            FAMILY_MEMBERS.forEach(member => {
                const cell = row.insertCell();
                cell.className = 'spreadsheet-cell text-center text-xl font-bold cursor-pointer transition duration-100';

                // Highlight if this is the current user
                if (currentUserMemberId && member.id === currentUserMemberId) {
                    cell.classList.add('current-user-column');
                }

                cell.dataset.id = item.id;
                cell.dataset.field = `attendees.${member.id}`;

                const isAttending = item.attendees && item.attendees[member.id] === 'Y';
                cell.textContent = isAttending ? '✓' : '';

                if (isAttending) {
                    cell.classList.add('bg-green-100', 'text-green-700', 'hover:bg-green-200');
                } else {
                    cell.classList.add('bg-white', 'text-gray-300', 'hover:bg-red-50');
                }
                cell.addEventListener('click', handleAttendeeToggle);
            });
        });
    });
}

// --- DRAG AND DROP LOGIC ---

let dragSrcEl = null;

function setupDragAndDrop() {
    const tableBody = document.getElementById('itinerary-table-body');
    if (!tableBody) return;
    tableBody.addEventListener('dragstart', handleDragStart);
    tableBody.addEventListener('dragover', handleDragOver);
    tableBody.addEventListener('dragleave', handleDragLeave);
    tableBody.addEventListener('drop', handleDrop);
    tableBody.addEventListener('dragend', handleDragEnd);
}

function handleDragStart(e) {
    const targetRow = e.target.closest('.draggable-row');
    if (!targetRow) return;

    dragSrcEl = targetRow;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcEl.dataset.id);

    setTimeout(() => {
        dragSrcEl.classList.add('dragging');
    }, 0);
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetRow = e.target.closest('.draggable-row');
    // Look for the group header cell we added class to
    const targetHeader = e.target.closest('.group-header-cell');

    if (!targetRow && !targetHeader) return;
    if (targetRow === dragSrcEl) return;

    document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-header').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-header');
    });

    if (targetRow) {
        const rect = targetRow.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < rect.height / 2) {
            targetRow.classList.add('drag-over-top');
        } else {
            targetRow.classList.add('drag-over-bottom');
        }
    } else if (targetHeader) {
        targetHeader.classList.add('drag-over-header');
    }
    return false;
}

function handleDragLeave(e) {
    const el = e.target.closest('.draggable-row') || e.target.closest('.group-header-cell');
    if (el) {
        el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-header');
    }
}

async function handleDrop(e) {
    e.stopPropagation();

    document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-header').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-header');
    });

    const dropTargetRow = e.target.closest('.draggable-row');
    const dropTargetHeader = e.target.closest('.group-header-cell');

    if (!dropTargetRow && !dropTargetHeader) return false;
    if (dragSrcEl === dropTargetRow) return false;

    const draggedId = dragSrcEl.dataset.id;
    const sourceGroupKey = dragSrcEl.dataset.groupKey;

    let targetGroupKey;
    let targetDateName;
    let insertIndex = 0;
    let isCrossGroup = false;

    if (dropTargetRow) {
        targetGroupKey = dropTargetRow.dataset.groupKey;
        // Correctly find the header using the new class
        const header = Array.from(document.querySelectorAll('.group-header-cell')).find(cell => cell.dataset.groupKey === targetGroupKey);
        targetDateName = header ? header.dataset.groupName : 'TBC';
    } else if (dropTargetHeader) {
        targetGroupKey = dropTargetHeader.dataset.groupKey;
        targetDateName = dropTargetHeader.dataset.groupName;
    }

    isCrossGroup = sourceGroupKey !== targetGroupKey;

    const targetGroupItems = window.currentItineraryItems.filter(item => {
        return getPrimarySortValue(item.date).toString() === targetGroupKey;
    });

    const draggedItem = window.currentItineraryItems.find(item => item.id === draggedId);
    if (!draggedItem) return;

    let newItemsList = [...targetGroupItems];

    if (!isCrossGroup) {
        newItemsList = newItemsList.filter(item => item.id !== draggedId);
    }

    if (dropTargetRow) {
        const targetId = dropTargetRow.dataset.id;
        const isDroppingBefore = dropTargetRow.classList.contains('drag-over-top');
        let idx = newItemsList.findIndex(item => item.id === targetId);
        if (!isDroppingBefore) idx++;
        insertIndex = idx;
    } else {
        insertIndex = newItemsList.length;
    }

    newItemsList.splice(insertIndex, 0, draggedItem);

    const batch = db.batch();

    if (isCrossGroup) {
        const docRef = db.collection(ITINERARY_COLLECTION_PATH).doc(draggedId);
        let newDateVal = targetDateName;
        if (targetDateName.includes('TBC')) newDateVal = 'TBC';

        batch.update(docRef, { date: newDateVal });
    }

    newItemsList.forEach((item, index) => {
        const newOrder = index + 1;
        if ((item.timeOrder || 0) !== newOrder) {
            const docRef = db.collection(ITINERARY_COLLECTION_PATH).doc(item.id);
            batch.update(docRef, { timeOrder: newOrder });
        }
    });

    try {
        await batch.commit();
        console.log(`Reordered/Moved items.`);
    } catch (err) {
        console.error("Batch update failed", err);
    }

    return true;
}

function handleDragEnd(e) {
    if (dragSrcEl) {
        dragSrcEl.classList.remove('dragging');
        dragSrcEl = null;
    }
}

// --- DATE & CELL EDITING ---

function handleDateCellClick(event, id) {
    const cell = event.currentTarget;
    if (cell.querySelector('input')) return;

    // Allow editing TBC cells now!
    // if (cell.dataset.groupKey === getPrimarySortValue('TBC').toString()) return;

    const currentText = cell.textContent.trim();

    // Use a text input instead of date to allow "TBC"
    const dateInput = document.createElement('input');
    dateInput.type = 'text';
    dateInput.className = 'w-full h-full p-1 border border-blue-300 rounded text-sm font-semibold';
    dateInput.value = currentText === 'TBC' ? '' : currentText;
    dateInput.placeholder = "e.g. Dec 25 or TBC";

    cell.textContent = '';
    cell.appendChild(dateInput);
    dateInput.focus();

    dateInput.addEventListener('blur', async () => {
        let newVal = dateInput.value.trim();
        dateInput.remove();

        // Default to TBC if empty or explicitly TBC
        if (!newVal || newVal.toLowerCase() === 'tbc') {
            newVal = 'TBC';
        } else {
            // Simple formatting helper: capitalize first letter
            newVal = newVal.charAt(0).toUpperCase() + newVal.slice(1);
        }

        cell.textContent = newVal;

        if (newVal !== currentText) {
            try {
                await db.collection(ITINERARY_COLLECTION_PATH).doc(id).update({
                    date: newVal,
                    timeOrder: 0 // Reset order to push to end of new group
                });
            } catch (e) {
                console.error("Error updating date:", e);
                cell.textContent = currentText; // Revert on error
            }
        }
    });

    // Allow Enter key to save
    dateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') dateInput.blur();
    });
}

async function handleCellEdit(event) {
    if (!db) return;
    const target = event.target;
    const id = target.dataset.id;
    const field = target.dataset.field;
    let value = target.textContent.trim();

    if (field === 'date') return;

    try {
        await db.collection(ITINERARY_COLLECTION_PATH).doc(id).update({ [field]: value });
    } catch (e) {
        console.error("Error updating document field:", e);
    }
}

async function handleAttendeeToggle(event) {
    if (!db) return;
    const target = event.target;
    const id = target.dataset.id;
    const field = target.dataset.field;
    if (!id || !field) return;

    const memberId = field.split('.')[1];
    const currentItem = window.currentItineraryItems.find(item => item.id === id);
    if (!currentItem) return;

    const isAttending = currentItem.attendees && currentItem.attendees[memberId] === 'Y';
    const nextValue = isAttending ? 'N' : 'Y';

    try {
        await db.collection(ITINERARY_COLLECTION_PATH).doc(id).update({ [`attendees.${memberId}`]: nextValue });
    } catch (e) {
        console.error("Error updating attendee status:", e);
    }
}

window.addItineraryRow = async function () {
    if (!isAuthReady || !db) return;

    const tbcGroupKey = getPrimarySortValue('TBC').toString();
    const tbcItems = window.currentItineraryItems.filter(item => getPrimarySortValue(item.date).toString() === tbcGroupKey);
    const maxOrder = tbcItems.reduce((max, item) => Math.max(max, item.timeOrder || 0), 0);
    const newOrder = maxOrder + 1;

    try {
        const newItem = createItineraryItem('TBC', 'New Idea / Reservation', 'Idea', 'Marc, Melissa', newOrder);
        await db.collection(ITINERARY_COLLECTION_PATH).add(newItem);
    } catch (e) {
        console.error("Error adding document: ", e);
    }
}



// --- GPT LOGIC ---

// --- GALLERY LOGIC ---

window.unlockUploads = function () {
    const answer = prompt(SECURITY_QUESTION);
    if (answer && answer.trim().toLowerCase() === SECURITY_ANSWER.toLowerCase()) {
        document.getElementById('upload-locked').classList.add('hidden');
        document.getElementById('upload-unlocked').classList.remove('hidden');
    } else {
        alert("Incorrect answer. Uploads remain locked.");
    }
}

window.uploadPhotos = async function (files) {
    if (!files.length) return;
    const status = document.getElementById('upload-status');

    const storageRef = firebase.storage().ref();
    const user = FAMILY_MEMBERS.find(m => m.id === currentUserMemberId) || { name: "Guest" };

    let completed = 0;
    const total = files.length;

    for (let file of files) {
        status.innerText = `Uploading ${file.name} (0%)...`;
        const fileName = `photos/${Date.now()}_${file.name}`;
        const fileRef = storageRef.child(fileName);

        const uploadTask = fileRef.put(file);

        // Monitoring
        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                status.innerText = `Uploading ${file.name} (${Math.round(progress)}%)...`;
            },
            (error) => {
                console.error("Upload Error:", error);
                status.innerText = `Error: ${error.message}. Check Console (F12).`;
            }
        );

        try {
            await uploadTask;
            const url = await fileRef.getDownloadURL();

            await db.collection(PHOTO_COLLECTION_PATH).add({
                url: url,
                uploader: user.name.split(' ')[0],
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                fileName: file.name
            });
            completed++;
        } catch (error) {
            console.error("Final Upload Fail", error);
        }
    }

    if (completed === total) {
        status.innerText = "All uploads complete! Add more?";
        document.getElementById('photo-upload').value = "";
    }
}

function renderGallery(photos) {
    const gallery = document.getElementById('photo-gallery');
    if (!gallery) return;
    gallery.innerHTML = '';

    if (photos.length === 0) {
        gallery.innerHTML = '<div class="col-span-full text-center py-10 text-gray-500">No memories yet. Be the first to add one!</div>';
        return;
    }

    photos.forEach(photo => {
        const div = document.createElement('div');
        div.className = "relative group overflow-hidden rounded-xl shadow-lg aspect-square bg-gray-200";

        div.innerHTML = `
            <img src="${photo.url}" class="object-cover w-full h-full transform transition duration-500 group-hover:scale-110" loading="lazy" alt="Memory">
            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 group-hover:opacity-100 transition duration-300">
                <p class="text-white text-xs font-bold">📸 ${photo.uploader}</p>
            </div>
        `;
        // Lightbox on click (simple)
        div.onclick = () => window.open(photo.url, '_blank');
        gallery.appendChild(div);
    });
}

window.saveApiKey = function () {
    const keyInput = document.getElementById('gemini-api-key');
    const key = keyInput.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        alert("API Key saved! You can now ask Mickey's Pal questions.");
        keyInput.value = '';
    } else {
        alert("Please enter a valid key.");
    }
}

// (End of GPT logic)
document.addEventListener('DOMContentLoaded', () => {
    initializeFirebase();
    checkLoginStatus();
    startCountdown();
    setupDoubleScroll();
});

// --- COLUMN RESIZING ---
let currentResizer = null;
let startX = 0;
let startWidth = 0;
let headerElement = null;

function setupResizableColumns() {
    const resizers = document.querySelectorAll('.resizer');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', handleMouseDown);
    });
}

function handleMouseDown(e) {
    currentResizer = e.target;
    currentResizer.classList.add('resizing');

    headerElement = currentResizer.parentElement;
    startX = e.clientX;
    startWidth = headerElement.offsetWidth;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    e.preventDefault();
}

function handleMouseMove(e) {
    if (!currentResizer) return;
    const newWidth = startWidth + (e.clientX - startX);
    if (newWidth > 60) {
        headerElement.style.width = `${newWidth}px`;
    }
}

function handleMouseUp() {
    if (currentResizer) {
        currentResizer.classList.remove('resizing');
        currentResizer = null;
        headerElement = null;
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
}

function setupDoubleScroll() {
    const topContainer = document.getElementById('top-scroll-container');
    const topContent = document.getElementById('top-scroll-content');
    const tableContainer = document.getElementById('itinerary-table-container');
    const table = document.getElementById('itinerary-table');

    if (!topContainer || !topContent || !tableContainer || !table) return;

    const syncWidth = () => {
        topContent.style.width = table.offsetWidth + 'px';
    };

    syncWidth();
    const resizeObserver = new ResizeObserver(syncWidth);
    resizeObserver.observe(table);

    topContainer.addEventListener('scroll', () => {
        if (tableContainer.scrollLeft !== topContainer.scrollLeft) {
            tableContainer.scrollLeft = topContainer.scrollLeft;
        }
    });

    tableContainer.addEventListener('scroll', () => {
        if (topContainer.scrollLeft !== tableContainer.scrollLeft) {
            topContainer.scrollLeft = tableContainer.scrollLeft;
        }
    });
}
