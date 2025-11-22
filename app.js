// --- GLOBAL CONFIGURATION ---

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
    { id: "Marc", name: "Marc Blair", age: 43 },
    { id: "Melissa", name: "Melissa Blair", age: 39 },
    { id: "Billie", name: "Billie Blair", age: 10 },
    { id: "Mimi", name: "Mimi Blair", age: 6 },
    { id: "Daniel", name: "Daniel Rosenberg", age: 39 },
    { id: "Jessica", name: "Jessica Blair", age: 37 },
    { id: "Joey", name: "Joey Rosenberg", age: 5 },
    { id: "Emma", name: "Emma Rosenberg", age: 7 },
    { id: "Riley", name: "Riley Rosenberg", age: 1 },
    { id: "John", name: "John Blair", age: 71 },
    { id: "Lindsay", name: "Lindsay Blair", age: 70 },
    { id: "Ricky", name: "Ricky Blair", age: 41 },
];

const ITINERARY_COLLECTION_PATH = `artifacts/${appId}/public/data/orlando_planning_itinerary_items`;
const CHAT_COLLECTION_PATH = `artifacts/${appId}/public/data/orlando_planning_chat`;
const PACKING_COLLECTION_PATH = `artifacts/${appId}/public/data/orlando_planning_packing_list`;

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
            await initializeItinerary();
            await initializePackingList(); // Initialize packing list data
            setupResizableColumns();
            setupDragAndDrop();
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

    db.collection(CHAT_COLLECTION_PATH).onSnapshot((snapshot) => {
        const messages = snapshot.docs.map(d => d.data());
        messages.sort((a, b) => {
            const timeA = a.timestamp ? a.timestamp.toMillis() : 0;
            const timeB = b.timestamp ? b.timestamp.toMillis() : 0;
            return timeA - timeB;
        });
        renderChat(messages);
    });

    db.collection(PACKING_COLLECTION_PATH).onSnapshot((snapshot) => {
        const packingItems = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
        renderPackingList(packingItems);
    });
}

// --- PACKING LIST LOGIC ---

async function initializePackingList() {
    if (!db) return;
    const collectionRef = db.collection(PACKING_COLLECTION_PATH);
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
        for (const item of initialItems) {
            await collectionRef.add(item);
        }
    }
}

function renderPackingList(items) {
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
                li.innerHTML = `
                    <label class="flex items-center cursor-pointer flex-grow">
                        <input type="checkbox" class="form-checkbox h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500 transition duration-150 ease-in-out" 
                            ${item.checked ? 'checked' : ''} 
                            onchange="togglePackingItem('${item.id}', ${!item.checked})">
                        <span class="ml-2 text-sm ${item.checked ? 'line-through text-gray-400' : 'text-gray-700'}">${item.item}</span>
                    </label>
                    <button onclick="deletePackingItem('${item.id}')" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity px-2">
                        &times;
                    </button>
                `;
                list.appendChild(li);
            });
        }
        card.appendChild(list);

        // Add Item Input
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

        container.appendChild(card);
    });
}

window.addPackingItem = async function (personId) {
    if (!db) return;
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
    try {
        await db.collection(PACKING_COLLECTION_PATH).doc(itemId).update({ checked: checked });
    } catch (e) {
        console.error("Error toggling item:", e);
    }
}

window.deletePackingItem = async function (itemId) {
    if (!db) return;
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
        "Dec 28": 1228, "Dec 29": 1229, "Jan 1": 101, "Jan 2": 102
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

// --- CHAT LOGIC ---

function renderChat(messages) {
    const chatLog = document.getElementById('chat-messages');
    if (!chatLog) return;
    chatLog.innerHTML = '';
    if (messages.length === 0) chatLog.innerHTML = '<p class="text-center text-gray-500 py-4">No suggestions yet!</p>';

    messages.forEach(msg => {
        const messageElement = document.createElement('div');
        messageElement.className = 'mb-3 p-3 rounded-lg shadow-sm';
        const isMine = msg.userId === userId;

        if (isMine) {
            messageElement.classList.add('bg-red-100', 'ml-auto', 'max-w-[90%]');
        } else {
            messageElement.classList.add('bg-white', 'mr-auto', 'max-w-[90%]');
        }

        const date = msg.timestamp ? new Date(msg.timestamp.toMillis()) : new Date();
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const userName = msg.userName || 'Anonymous Planner';

        messageElement.innerHTML = `
            <p class="text-xs ${isMine ? 'text-red-700' : 'text-gray-500'} font-semibold mb-1">
                ${userName} <span class="float-right font-normal text-gray-400">${timeString}</span>
            </p>
            <p class="text-gray-800 whitespace-pre-wrap">${msg.text}</p>
        `;
        chatLog.appendChild(messageElement);
    });
    chatLog.scrollTop = chatLog.scrollHeight;
}

window.sendMessage = async function () {
    if (!db) return;
    const chatInput = document.getElementById('chat-input');
    const val = chatInput.value.trim();
    if (!val) return;

    const user = auth.currentUser;
    const userName = user ? user.uid.substring(0, 8) : 'Guest Planner';

    await db.collection(CHAT_COLLECTION_PATH).add({
        userId: userId,
        userName: userName,
        text: val,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
    chatInput.value = '';
}

// --- GPT LOGIC ---

window.sendGptQuery = async function () {
    const inputElement = document.getElementById('gpt-input');
    const chatLog = document.getElementById('gpt-chat-log');
    const userQuery = inputElement.value.trim();
    if (!userQuery) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = "p-3 rounded-lg shadow-sm mb-3 bg-red-100 ml-auto max-w-[90%]";
    msgDiv.innerHTML = `<p class="text-xs text-red-700 font-semibold">You</p><p>${userQuery}</p>`;
    chatLog.appendChild(msgDiv);
    inputElement.value = '';

    const loadingDiv = document.createElement('div');
    loadingDiv.innerHTML = "Thinking... 🧠";
    loadingDiv.className = "text-sm text-gray-500 p-2";
    chatLog.appendChild(loadingDiv);
    chatLog.scrollTop = chatLog.scrollHeight;

    setTimeout(() => {
        loadingDiv.remove();
        const responseDiv = document.createElement('div');
        responseDiv.className = "p-3 rounded-lg shadow-sm mb-3 bg-white mr-auto max-w-[90%] border border-gray-200";
        responseDiv.innerHTML = `<p class="text-xs text-blue-600 font-semibold">Mickey's Pal</p><p>That's a great question about "${userQuery}"! I'm currently in demo mode, but I'd recommend checking the official Disney World app for real-time updates!</p>`;
        chatLog.appendChild(responseDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    }, 1500);
}

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

// --- BOOTSTRAP ---
window.onload = function () {
    initializeFirebase();
    setupDoubleScroll();
}

// --- DOUBLE SCROLLBAR LOGIC ---
function setupDoubleScroll() {
    const topContainer = document.getElementById('top-scroll-container');
    const topContent = document.getElementById('top-scroll-content');
    const tableContainer = document.getElementById('itinerary-table-container');
    const table = document.getElementById('itinerary-table');

    if (!topContainer || !topContent || !tableContainer || !table) return;

    // Sync width
    const syncWidth = () => {
        topContent.style.width = table.offsetWidth + 'px';
    };

    // Initial sync and on resize
    syncWidth();
    // Use ResizeObserver for more robust width syncing
    const resizeObserver = new ResizeObserver(syncWidth);
    resizeObserver.observe(table);

    // Sync scroll positions
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

