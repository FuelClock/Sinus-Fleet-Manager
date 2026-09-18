// Squad Manager Plugin v1.0.0 for SinusBot
// Dynamic squad and division management system
// Commands: !ss on/off, !squadsystem on/off, !ss+

registerPlugin({
    name: 'Squad Manager',
    version: '1.0.0',
    description: 'Dynamic squad and division management system with automatic channel creation/deletion',
    author: 'FuelClock',
    backends: ['ts3'],
    vars: [
        { name: 'BOT_NAME', title: 'Bot Command Name', type: 'string', default: 'ss' },
        { name: 'ADMIN_GROUP', title: 'Admin Server Group ID (can manage squad system)', type: 'string', default: '17' },
        { name: 'PARENT_CHANNEL_ID', title: 'Channel ID of existing parent channel', type: 'channel' },
        { name: 'COMMAND_ROOM_NAME', title: 'Command Room Channel Name', type: 'string', default: 'Command Room' },
        { name: 'SPACER_NAME', title: 'Spacer Channel Name', type: 'string', default: '── Squad System ──' },
        { name: 'DIVISION_NAMING_MODE', title: 'Division Naming Mode', type: 'select', options: ['number', 'pool'] },
        { name: 'DIVISION_NAME_POOL', title: 'Division Name Pool (comma-separated)', type: 'string', default: 'Alpha,Bravo,Charlie,Delta' },
        { name: 'MAX_SQUADS', title: 'Max Squads Per Division', type: 'number', default: 4 },
        { name: 'DIVISION_DELETE_DELAY', title: 'Division Delete Delay (seconds)', type: 'number', default: 60 },
        {
            name: 'SQUAD_PERMISSIONS',
            title: 'Squad Channel Permissions',
            type: 'array',
            vars: [
                {
                    name: 'permission',
                    title: 'Channel Permission',
                    indent: 3,
                    type: 'select',
                    options: [
                        'Custom',
                        'i_channel_needed_join_power',
                        'i_channel_needed_subscribe_power',
                        'i_channel_needed_description_view_power',
                        'i_channel_needed_modify_power',
                        'i_channel_needed_delete_power'
                    ]
                },
                {
                    name: 'customPermission',
                    title: 'Name of the custom Permission',
                    indent: 3,
                    type: 'string',
                    conditions: [
                        { field: 'permission', value: 0 }
                    ]
                },
                {
                    name: 'value',
                    title: 'Value of the chosen Permission',
                    indent: 3,
                    type: 'number'
                }
            ]
        },
        {
            name: 'DIVISION_PERMISSIONS',
            title: 'Division Channel Permissions',
            type: 'array',
            vars: [
                {
                    name: 'permission',
                    title: 'Channel Permission',
                    indent: 3,
                    type: 'select',
                    options: [
                        'Custom',
                        'i_channel_needed_join_power',
                        'i_channel_needed_subscribe_power',
                        'i_channel_needed_description_view_power',
                        'i_channel_needed_modify_power',
                        'i_channel_needed_delete_power'
                    ]
                },
                {
                    name: 'customPermission',
                    title: 'Name of the custom Permission',
                    indent: 3,
                    type: 'string',
                    conditions: [
                        { field: 'permission', value: 0 }
                    ]
                },
                {
                    name: 'value',
                    title: 'Value of the chosen Permission',
                    indent: 3,
                    type: 'number'
                }
            ]
        },
        {
            name: 'COMMAND_ROOM_PERMISSIONS',
            title: 'Command Room Permissions',
            type: 'array',
            vars: [
                {
                    name: 'permission',
                    title: 'Channel Permission',
                    indent: 3,
                    type: 'select',
                    options: [
                        'Custom',
                        'i_channel_needed_join_power',
                        'i_channel_needed_subscribe_power',
                        'i_channel_needed_description_view_power',
                        'i_channel_needed_modify_power',
                        'i_channel_needed_delete_power'
                    ]
                },
                {
                    name: 'customPermission',
                    title: 'Name of the custom Permission',
                    indent: 3,
                    type: 'string',
                    conditions: [
                        { field: 'permission', value: 0 }
                    ]
                },
                {
                    name: 'value',
                    title: 'Value of the chosen Permission',
                    indent: 3,
                    type: 'number'
                }
            ]
        }
    ],
    requiredModules: ['engine', 'backend', 'event', 'store'],
    autorun: false
}, function(_, config, meta) {
    const engine = require('engine');
    const backend = require('backend');
    const event = require('event');
    const store = require('store');

    var botName = String(config.BOT_NAME || 'ss');
    var adminGroupId = String(config.ADMIN_GROUP || '17');
    var parentChannelId = String(config.PARENT_CHANNEL_ID || '');
    var commandRoomName = String(config.COMMAND_ROOM_NAME || 'Command Room');
    var spacerName = String(config.SPACER_NAME || '── Squad System ──');
    var divisionNamingMode = String(config.DIVISION_NAMING_MODE || 'number').toLowerCase();
    var divisionNamePool = String(config.DIVISION_NAME_POOL || 'Alpha,Bravo,Charlie,Delta');
    var maxSquads = parseInt(config.MAX_SQUADS) || 4;
    var divisionDeleteDelay = parseInt(config.DIVISION_DELETE_DELAY) || 60;
    var squadPermissions = config.SQUAD_PERMISSIONS || '';
    var divisionPermissions = config.DIVISION_PERMISSIONS || '';
    var commandRoomPermissions = config.COMMAND_ROOM_PERMISSIONS || '';

    var SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    var state = {
        squadSystemActive: false,
        divisionModeActive: false,
        parentChannelId: '',
        commandRoomId: '',
        spacerAboveId: '',
        spacerBelowId: '',
        divisions: [],
        createdChannelIds: [],
        divisionTimers: {}
    };

    // ===== HELPERS =====
    function logMessage(message, level) {
        engine.log(message);
    }

    function containsIgnoreCase(value, search) {
        return String(value || '').toLowerCase().indexOf(String(search || '').toLowerCase()) !== -1;
    }

    function equalsIgnoreCase(left, right) {
        return containsIgnoreCase(left, right) && containsIgnoreCase(right, left);
    }

    function isMemberOfOne(client, groups) {
        if (!client || typeof client.getServerGroups !== 'function') {
            return false;
        }
        var groupIds = Array.isArray(groups) ? groups : [groups];
        var clientGroups = client.getServerGroups();
        for (var i = 0; i < clientGroups.length; i++) {
            var clientId = String(clientGroups[i].id());
            for (var j = 0; j < groupIds.length; j++) {
                if (clientId === String(groupIds[j])) {
                    return true;
                }
            }
        }
        return false;
    }

    function isAdmin(invoker) {
        return isMemberOfOne(invoker, [adminGroupId]);
    }

    function getReplyFn(ev) {
        if (ev.mode === 2 && ev.channel && typeof ev.channel === 'function') {
            var channel = ev.channel();
            if (channel && typeof channel.chat === 'function') {
                return function(msg) { channel.chat(msg); };
            }
        }
        if (ev.mode === 1 && ev.client && typeof ev.client.chat === 'function') {
            return function(msg) { ev.client.chat(msg); };
        }
        if (ev.mode === 3) {
            return function(msg) { backend.chat(msg); };
        }
        return function(msg) {
            if (ev.client && typeof ev.client.chat === 'function') {
                ev.client.chat(msg);
            } else {
                backend.chat(msg);
            }
        };
    }

    function parseNames(value) {
        var result = [];
        var parts = String(value || '').split(',');
        for (var i = 0; i < parts.length; i++) {
            var name = String(parts[i] || '').trim();
            if (name) {
                result.push(name);
            }
        }
        return result;
    }

    function parsePermissions(value) {
        if (!value) {
            return [];
        }
        // Handle array format (new)
        if (Array.isArray(value)) {
            return value;
        }
        // Handle JSON string format (old)
        try {
            var parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            if (typeof parsed === 'object' && parsed !== null) {
                var result = [];
                for (var key in parsed) {
                    if (parsed.hasOwnProperty(key)) {
                        result.push({
                            permission: key,
                            value: parsed[key]
                        });
                    }
                }
                return result;
            }
        } catch (e) {
            logMessage('WARNING: Could not parse permissions JSON: ' + e.message, 2);
        }
        return [];
    }

    function applyPermissions(channel, permissionConfig) {
        if (!channel || typeof channel.addPermission !== 'function') {
            return;
        }
        var permissions = parsePermissions(permissionConfig);
        if (!permissions || permissions.length === 0) {
            return;
        }
        setTimeout(function() {
            for (var i = 0; i < permissions.length; i++) {
                var currentPermission = permissions[i];
                var defaultPermissions = [
                    currentPermission.customPermission,
                    'i_channel_needed_join_power',
                    'i_channel_needed_subscribe_power',
                    'i_channel_needed_description_view_power',
                    'i_channel_needed_modify_power',
                    'i_channel_needed_delete_power'
                ];
                var permissionName = defaultPermissions[parseInt(currentPermission.permission || '0')];
                if (!permissionName) {
                    continue;
                }
                try {
                    var permission = channel.addPermission(permissionName);
                    permission.setValue(currentPermission.value);
                    permission.save();
                    logMessage('Squad Manager: Applied permission ' + permissionName + ' = ' + currentPermission.value + ' to ' + channel.name(), 4);
                } catch (e) {
                    logMessage('Squad Manager: Failed to apply permission ' + permissionName + ' to ' + channel.name() + ': ' + e.message, 2);
                }
            }
        }, 500);
    }

    function getChannelById(id) {
        if (!id) {
            return null;
        }
        return backend.getChannelByID(String(id));
    }

    function createChannel(name, parentId, extraParams) {
        var params = {
            name: name,
            parent: parentId,
            permanent: false,
            semiPermanent: false,
            deleteDelay: 2
        };
        if (extraParams) {
            for (var key in extraParams) {
                if (extraParams.hasOwnProperty(key)) {
                    params[key] = extraParams[key];
                }
            }
        }
        try {
            var channel = backend.createChannel(params);
            if (channel) {
                state.createdChannelIds.push(String(channel.id()));
                logMessage('Squad Manager: Created channel "' + name + '" (id=' + channel.id() + ') under parent ' + parentId, 4);
            }
            return channel;
        } catch (e) {
            logMessage('Squad Manager: Failed to create channel "' + name + '": ' + e.message, 1);
            return null;
        }
    }

    function deleteChannel(channelId) {
        var id = String(channelId);
        if (state.createdChannelIds.indexOf(id) === -1) {
            logMessage('Squad Manager: Refusing to delete channel not created by plugin: ' + id, 2);
            return false;
        }
        var channel = getChannelById(id);
        if (!channel) {
            state.createdChannelIds = state.createdChannelIds.filter(function(x) { return String(x) !== id; });
            return false;
        }
        try {
            channel.delete();
            state.createdChannelIds = state.createdChannelIds.filter(function(x) { return String(x) !== id; });
            logMessage('Squad Manager: Deleted channel "' + channel.name() + '" (id=' + id + ')', 4);
            return true;
        } catch (e) {
            logMessage('Squad Manager: Failed to delete channel "' + channel.name() + '" (id=' + id + '): ' + e.message, 2);
            return false;
        }
    }

    function moveChannel(channelId, newParentId) {
        var id = String(channelId);
        if (state.createdChannelIds.indexOf(id) === -1) {
            logMessage('Squad Manager: Refusing to move channel not created by plugin: ' + id, 2);
            return false;
        }
        var channel = getChannelById(id);
        if (!channel || typeof channel.moveTo !== 'function') {
            return false;
        }
        try {
            channel.moveTo(newParentId);
            return true;
        } catch (e) {
            logMessage('Squad Manager: Failed to move channel "' + channel.name() + '" (id=' + id + '): ' + e.message, 2);
            return false;
        }
    }

    function getChannelClients(channelId) {
        var channel = getChannelById(channelId);
        if (!channel || typeof channel.getClients !== 'function') {
            return [];
        }
        try {
            return channel.getClients() || [];
        } catch (e) {
            return [];
        }
    }

    function saveState() {
        try {
            store.set('squadManagerState', JSON.stringify({
                squadSystemActive: state.squadSystemActive,
                divisionModeActive: state.divisionModeActive,
                parentChannelId: state.parentChannelId,
                commandRoomId: state.commandRoomId,
                spacerAboveId: state.spacerAboveId,
                spacerBelowId: state.spacerBelowId,
                divisions: state.divisions,
                createdChannelIds: state.createdChannelIds
            }));
        } catch (e) {
            logMessage('Squad Manager: Failed to save state: ' + e.message, 2);
        }
    }

    function loadState() {
        try {
            var stored = store.get('squadManagerState');
            if (stored) {
                var parsed = JSON.parse(stored);
                if (parsed && typeof parsed === 'object') {
                    state.squadSystemActive = !!parsed.squadSystemActive;
                    state.divisionModeActive = !!parsed.divisionModeActive;
                    state.parentChannelId = String(parsed.parentChannelId || '');
                    state.commandRoomId = String(parsed.commandRoomId || '');
                    state.spacerAboveId = String(parsed.spacerAboveId || '');
                    state.spacerBelowId = String(parsed.spacerBelowId || '');
                    state.divisions = Array.isArray(parsed.divisions) ? parsed.divisions : [];
                    state.createdChannelIds = Array.isArray(parsed.createdChannelIds) ? parsed.createdChannelIds : [];
                    return true;
                }
            }
        } catch (e) {
            logMessage('Squad Manager: Failed to load state: ' + e.message, 2);
        }
        return false;
    }

    function findDivision(divisionId) {
        for (var i = 0; i < state.divisions.length; i++) {
            if (String(state.divisions[i].id) === String(divisionId)) {
                return state.divisions[i];
            }
        }
        return null;
    }

    function findSquad(squadId) {
        for (var i = 0; i < state.divisions.length; i++) {
            var squads = state.divisions[i].squads;
            for (var j = 0; j < squads.length; j++) {
                if (String(squads[j].id) === String(squadId)) {
                    return {
                        division: state.divisions[i],
                        squad: squads[j]
                    };
                }
            }
        }
        return null;
    }

    function getSquadByIndex(division, index) {
        for (var i = 0; i < division.squads.length; i++) {
            if (division.squads[i].index === index) {
                return division.squads[i];
            }
        }
        return null;
    }

    function removeSquadFromState(division, index) {
        for (var i = 0; i < division.squads.length; i++) {
            if (division.squads[i].index === index) {
                division.squads.splice(i, 1);
                return;
            }
        }
    }

    function getDivisionName() {
        if (divisionNamingMode === 'pool') {
            var names = parseNames(divisionNamePool);
            var usedNames = [];
            for (var i = 0; i < state.divisions.length; i++) {
                usedNames.push(state.divisions[i].name);
            }
            for (var j = 0; j < names.length; j++) {
                if (usedNames.indexOf(names[j]) === -1) {
                    return names[j];
                }
            }
            return 'Division ' + (state.divisions.length + 1);
        }
        var maxNum = 0;
        for (var i = 0; i < state.divisions.length; i++) {
            var match = state.divisions[i].name.match(/(\d+)$/);
            if (match) {
                var num = parseInt(match[1]);
                if (num > maxNum) {
                    maxNum = num;
                }
            }
        }
        return 'Division ' + (maxNum + 1);
    }

    function createDivision(name) {
        var division = {
            id: '',
            name: name,
            squads: []
        };
        var channel = createChannel(name, state.commandRoomId, {
            description: '',
            topic: ''
        });
        if (!channel) {
            return null;
        }
        applyPermissions(channel, divisionPermissions);
        division.id = String(channel.id());
        state.divisions.push(division);
        return division;
    }

    function createSquad(division, index) {
        if (index < 0 || index >= maxSquads) {
            return null;
        }
        for (var i = 0; i < division.squads.length; i++) {
            if (division.squads[i].index === index) {
                return division.squads[i];
            }
        }
        var name = 'Squad ' + SQUAD_NAMES[index];
        var channel = createChannel(name, division.id, {
            description: '',
            topic: ''
        });
        if (!channel) {
            return null;
        }
        applyPermissions(channel, squadPermissions);
        var squad = {
            index: index,
            name: name,
            id: String(channel.id())
        };
        division.squads.push(squad);
        return squad;
    }

    function deleteSquad(division, index) {
        var squad = getSquadByIndex(division, index);
        if (!squad) {
            return;
        }
        deleteChannel(squad.id);
        removeSquadFromState(division, index);
    }

    function deleteDivision(divisionId) {
        var division = findDivision(divisionId);
        if (!division) {
            return;
        }
        for (var i = 0; i < division.squads.length; i++) {
            deleteChannel(division.squads[i].id);
        }
        deleteChannel(division.id);
        state.divisions = state.divisions.filter(function(d) {
            return String(d.id) !== String(divisionId);
        });
        if (state.divisionTimers[divisionId]) {
            clearTimeout(state.divisionTimers[divisionId]);
            delete state.divisionTimers[divisionId];
        }
    }

    function checkSquadCreation() {
        if (!state.squadSystemActive) {
            return;
        }
        for (var i = 0; i < state.divisions.length; i++) {
            var division = state.divisions[i];
            var previousHasMembers = true;
            for (var index = 0; index < maxSquads; index++) {
                var squad = getSquadByIndex(division, index);
                if (!squad) {
                    if (previousHasMembers) {
                        createSquad(division, index);
                    }
                    break;
                }
                var members = getChannelClients(squad.id);
                previousHasMembers = members.length > 0;
            }
        }
    }

    function checkSquadDeletion() {
        if (!state.squadSystemActive) {
            return;
        }
        for (var i = 0; i < state.divisions.length; i++) {
            var division = state.divisions[i];
            for (var index = maxSquads - 1; index >= 0; index--) {
                var squad = getSquadByIndex(division, index);
                if (!squad) {
                    continue;
                }
                var members = getChannelClients(squad.id);
                if (members.length === 0) {
                    deleteSquad(division, index);
                }
            }
        }
    }

    function checkDivisionDeletion() {
        for (var i = 0; i < state.divisions.length; i++) {
            var division = state.divisions[i];
            var hasMembers = false;
            for (var j = 0; j < division.squads.length; j++) {
                var members = getChannelClients(division.squads[j].id);
                if (members.length > 0) {
                    hasMembers = true;
                    break;
                }
            }
            if (!hasMembers && state.divisionTimers[division.id]) {
                deleteDivision(division.id);
            }
        }
    }

    function handleClientMove(ev) {
        if (!state.squadSystemActive || !ev || !ev.client || ev.client.isSelf()) {
            return;
        }
        checkSquadDeletion();
        checkSquadCreation();
        checkDivisionDeletion();
    }

    // ===== SQUAD SYSTEM =====
    function toggleSquadSystem(turnOn, invoker, reply) {
        if (turnOn) {
            if (state.squadSystemActive) {
                reply('[Squad Manager] Squad system is already active.');
                return;
            }
            if (!parentChannelId) {
                reply('[Squad Manager] No parent channel configured. Set PARENT_CHANNEL_ID first.');
                return;
            }
            var parent = getChannelById(parentChannelId);
            if (!parent) {
                reply('[Squad Manager] Parent channel not found: ' + parentChannelId);
                return;
            }
            state.squadSystemActive = true;
            state.parentChannelId = String(parentChannelId);
            state.divisionModeActive = false;
            state.divisions = [];
            state.divisionTimers = {};

            var spacerAbove = createChannel(spacerName, parentChannelId, {
                description: '',
                topic: ''
            });
            var commandRoom = createChannel(commandRoomName, parentChannelId, {
                description: '',
                topic: ''
            });
            var spacerBelow = createChannel(spacerName, parentChannelId, {
                description: '',
                topic: ''
            });

            if (!spacerAbove || !commandRoom || !spacerBelow) {
                state.squadSystemActive = false;
                reply('[Squad Manager] Failed to create squad system channels.');
                return;
            }

            applyPermissions(commandRoom, commandRoomPermissions);

            state.commandRoomId = String(commandRoom.id());
            state.spacerAboveId = String(spacerAbove.id());
            state.spacerBelowId = String(spacerBelow.id());

            var defaultDivision = {
                id: state.commandRoomId,
                name: commandRoomName,
                squads: []
            };
            state.divisions = [defaultDivision];

            createSquad(defaultDivision, 0);

            saveState();
            reply('[Squad Manager] Squad system activated. Command Room created.');
            logMessage('Squad Manager: Squad system activated. Command Room id=' + state.commandRoomId, 3);
        } else {
            if (!state.squadSystemActive) {
                reply('[Squad Manager] Squad system is already inactive.');
                return;
            }
            for (var i = 0; i < state.divisions.length; i++) {
                var division = state.divisions[i];
                for (var j = 0; j < division.squads.length; j++) {
                    deleteChannel(division.squads[j].id);
                }
                if (String(division.id) !== String(state.commandRoomId)) {
                    deleteChannel(division.id);
                }
            }
            if (state.spacerAboveId) {
                deleteChannel(state.spacerAboveId);
            }
            if (state.spacerBelowId) {
                deleteChannel(state.spacerBelowId);
            }
            if (state.commandRoomId) {
                deleteChannel(state.commandRoomId);
            }
            state.squadSystemActive = false;
            state.divisionModeActive = false;
            state.commandRoomId = '';
            state.spacerAboveId = '';
            state.spacerBelowId = '';
            state.divisions = [];
            state.divisionTimers = {};
            saveState();
            reply('[Squad Manager] Squad system deactivated. All created channels removed.');
            logMessage('Squad Manager: Squad system deactivated.', 3);
        }
    }

    function activateDivisionMode(reply) {
        if (!state.squadSystemActive) {
            reply('[Squad Manager] Squad system is not active.');
            return;
        }
        if (state.divisionModeActive) {
            reply('[Squad Manager] Division mode is already active.');
            return;
        }
        var defaultDivision = findDivision(state.commandRoomId);
        if (!defaultDivision) {
            reply('[Squad Manager] Command Room not found.');
            return;
        }

        var names = divisionNamingMode === 'pool' ? parseNames(divisionNamePool) : [];
        var division1Name = names.length > 0 ? names[0] : 'Division 1';
        var division2Name = names.length > 1 ? names[1] : 'Division 2';

        var division1 = createDivision(division1Name);
        var division2 = createDivision(division2Name);
        if (!division1 || !division2) {
            reply('[Squad Manager] Failed to create divisions.');
            return;
        }

        for (var i = 0; i < defaultDivision.squads.length; i++) {
            var squad = defaultDivision.squads[i];
            moveChannel(squad.id, division1.id);
        }
        division1.squads = defaultDivision.squads.slice();
        defaultDivision.squads = [];

        createSquad(division2, 0);

        state.divisionModeActive = true;
        state.divisions = [division1, division2];
        saveState();
        reply('[Squad Manager] Division mode activated. Existing squads moved to ' + division1Name + '.');
        logMessage('Squad Manager: Division mode activated.', 3);
    }

    function createNewDivision(reply) {
        if (!state.squadSystemActive) {
            reply('[Squad Manager] Squad system is not active.');
            return;
        }
        var division = createDivision(getDivisionName());
        if (!division) {
            reply('[Squad Manager] Failed to create new division.');
            return;
        }
        createSquad(division, 0);

        var divisionId = division.id;
        var timer = setTimeout(function() {
            var currentDivision = findDivision(divisionId);
            if (!currentDivision) {
                return;
            }
            var hasMembers = false;
            for (var i = 0; i < currentDivision.squads.length; i++) {
                var members = getChannelClients(currentDivision.squads[i].id);
                if (members.length > 0) {
                    hasMembers = true;
                    break;
                }
            }
            if (!hasMembers) {
                deleteDivision(divisionId);
                logMessage('Squad Manager: Deleted empty division "' + division.name + '" after ' + divisionDeleteDelay + ' seconds.', 3);
            }
            delete state.divisionTimers[divisionId];
        }, divisionDeleteDelay * 1000);
        state.divisionTimers[division.id] = timer;

        saveState();
        reply('[Squad Manager] Division "' + division.name + '" created. It will be deleted if empty after ' + divisionDeleteDelay + ' seconds.');
        logMessage('Squad Manager: Created division "' + division.name + '" (id=' + division.id + ').', 3);
    }

    function handleCommand(args, ev) {
        var invoker = ev.client;
        if (!isAdmin(invoker)) {
            var reply = getReplyFn(ev);
            reply('[Squad Manager] Permission denied.');
            return;
        }

        var reply = getReplyFn(ev);
        var parts = args.trim().split(/\s+/);
        var subCommand = parts[0].toLowerCase();

        if (subCommand === 'on') {
            toggleSquadSystem(true, invoker, reply);
            return;
        }
        if (subCommand === 'off') {
            toggleSquadSystem(false, invoker, reply);
            return;
        }
        if (subCommand === '+') {
            createNewDivision(reply);
            return;
        }
        if (subCommand === 'help') {
            reply('[Squad Manager] Commands: !' + botName + ' on, !' + botName + ' off, !' + botName + '+, !' + botName + ' help');
            return;
        }
        reply('[Squad Manager] Unknown command. Use !' + botName + ' help');
    }

    // ===== EVENTS =====
    event.on('chat', function(ev) {
        if (!ev || !ev.client || ev.client.isSelf()) {
            return;
        }
        var prefix = '!' + botName;
        var text = String(ev.text || '');
        if (text === prefix + '+') {
            handleCommand('+', ev);
            return;
        }
        if (text.indexOf(prefix + ' ') === 0) {
            var cmdText = text.substring(prefix.length + 1);
            handleCommand(cmdText, ev);
            return;
        }
        if (text === '!squadsystem on' || text === '!squadsystem off') {
            var parts = text.split(' ');
            handleCommand(parts[1], ev);
        }
    });

    event.on('clientMove', handleClientMove);

    event.on('load', function(ev) {
        logMessage('Squad Manager v1.0.0 loaded');
        if (backend.isConnected()) {
            initialize();
        } else {
            event.on('connect', function() {
                initialize();
            });
        }
    });

    function initialize() {
        logMessage('Squad Manager: Initializing...');
        loadState();
        if (state.squadSystemActive) {
            logMessage('Squad Manager: Squad system was active. Restoring channels...', 3);
            checkSquadCreation();
            checkSquadDeletion();
        }
        logMessage('Squad Manager: Initialization complete.', 3);
    }
});
