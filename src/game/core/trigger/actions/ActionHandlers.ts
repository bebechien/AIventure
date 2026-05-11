/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ILevelManager } from '../../Interfaces';
import { ActionType, TriggerContext } from '../TriggerTypes';
import { CONSTANTS } from '../../Constants';
import { EventBus } from '../../EventBus';

export type ActionHandler = (levelManager: ILevelManager, params: any, context: TriggerContext) => string | null;

const handlers: Partial<Record<ActionType, ActionHandler>> = {};

export function registerAction(type: ActionType, handler: ActionHandler) {
    handlers[type] = handler;
}

export function executeAction(type: ActionType, levelManager: ILevelManager, params: any, context: TriggerContext): string | null {
    const handler = handlers[type];
    if (handler) {
        return handler(levelManager, params, context);
    }
    return null;
}

// --- Helper Functions ---

function getGridBounds(props: any) {
    const halfWidth = props.width / 2;
    const halfHeight = props.height / 2;

    return {
        startGx: Math.floor((props.x - halfWidth) / CONSTANTS.GRID_SIZE),
        endGx: Math.floor((props.x + halfWidth - 0.01) / CONSTANTS.GRID_SIZE),
        startGy: Math.floor((props.y - halfHeight) / CONSTANTS.GRID_SIZE),
        endGy: Math.floor((props.y + halfHeight - 0.01) / CONSTANTS.GRID_SIZE)
    };
}

function removeMapObjectByTag(levelManager: ILevelManager, tag: string, shouldClearGrid: (gx: number, gy: number) => boolean = () => true) {
    console.log('removeMapObjectByTag called with tag:', tag);
    const objectsToRemove = levelManager.getObjectsByTag(tag);
    console.log('Found objects to remove:', objectsToRemove.length);

    objectsToRemove.forEach(obj => {
        const props = (obj as any).props;
        if (props) {
            const bounds = getGridBounds(props);

            for (let gx = bounds.startGx; gx <= bounds.endGx; gx++) {
                for (let gy = bounds.startGy; gy <= bounds.endGy; gy++) {
                    if (shouldClearGrid(gx, gy)) {
                        levelManager.gridManager.setBlocker(gx, gy, false);
                        levelManager.gridManager.setModelToolMap(gx, gy, null);
                    }
                }
            }

            console.log('Destroying object:', obj);
            obj.destroy();
        }
    });

    levelManager.mapObjects = levelManager.mapObjects.filter(obj => !objectsToRemove.includes(obj));
}

// --- Action Implementations ---

const openDoorHandler: ActionHandler = (levelManager, params, context) => {
    console.log('openDoorHandler called with params:', params, 'and context:', context);
    let color = params?.color;
    if (params?.usePayload && context.payload) {
        if (context.payload.linkURL) {
            color = context.payload.linkURL;
        } else if (context.payload.interaction) {
            color = context.payload.interaction.linkURL;
        }
    } else if (params?.extractFromFunctionName && context.payload?.name) {
        const parts = context.payload.name.split(params.extractFromFunctionName);
        if (parts.length > 1) color = parts[1];
    }

    console.log('Extracted color:', color);
    if (color) {
        const targetClass = `${color.charAt(0).toUpperCase()}${color.slice(1).toLowerCase()}Door`;
        console.log('Calling removeMapObjectByTag with targetClass:', targetClass);
        removeMapObjectByTag(levelManager, targetClass);
        return `Door ${color} opened.`;
    }
    return null;
};

const toggleLightHandler: ActionHandler = (levelManager, params, context) => {
    removeMapObjectByTag(levelManager, 'Dark', (gx, gy) => !levelManager.gridManager.getInteraction(gx, gy));
    return "Light toggled.";
};

const askModelHandler: ActionHandler = (levelManager, params, context) => {
    if (context.subject) {
        let text = context.subject.getContext ? context.subject.getContext() : "";
        if (context.subject.targetNPC) {
            EventBus.emit('ask-ai-npc', context.subject.targetNPC, text, params?.prompt);
        } else {
            EventBus.emit('ask-model', text, params?.prompt);
        }
        // This specific logic (8452 -> open door) should ideally be a separate rule or event listener,
        // but keeping it here to preserve original logic for now.
        // Actually, looking at original code:
        // if (text.includes("8452")) { this.openDoor("scroll"); }
        // This is highly specific. I'll keep it for now but note it.
        if (text.includes("8452")) {
           // We can reuse openDoorHandler logic or call it directly?
           // Or just duplicate the removal logic.
           // Let's call openDoorHandler to be clean.
           openDoorHandler(levelManager, { color: 'scroll' }, context);
        }
    }
    return null;
};

const findSwitchHandler: ActionHandler = (levelManager, params, context) => {
    const results: any[] = [];
    if (!levelManager.gridManager) return "No GridManager";

    const grid = levelManager.gridManager;
    for (let gy = 0; gy < grid.height; gy++) {
        for (let gx = 0; gx < grid.width; gx++) {
                const interaction = grid.getInteraction(gx, gy);
                if (interaction && interaction.type === 'switch') {
                    results.push({
                        x: gx,
                        y: gy,
                        type: interaction.type,
                        name: interaction.name || interaction.linkURL || 'unknown'
                    });
                }
        }
    }
    const found = results;
    const resultJson = JSON.stringify(found);

    // Provide feedback via thought bubble
    const agent = levelManager.agents[0];
    if (agent) {
        agent.setThought(`I found ${found.length} switch(es).`);
    }
    return resultJson;
};

const moveAgenthHandler: ActionHandler = (levelManager, params, context) => {
    if (context.payload?.args) {
        // Assuming args are [x, y] or {x, y}
        let x = context.payload.args[0];
        let y = context.payload.args[1];

        // Handle object format if applicable
        if (typeof context.payload.args === 'object' && !Array.isArray(context.payload.args)) {
            x = context.payload.args.x;
            y = context.payload.args.y;
        } else if (typeof context.payload.args === 'string') {
            const regex = /x:\s*(-?\d+)\s*,\s*y:\s*(-?\d+)/;
            const match = context.payload.args.match(regex);
            if (match) {
                x = parseInt(match[1], 10);
                y = parseInt(match[2], 10);
            } else {
                console.error("String format did not match expected pattern.")
            }
        }

        if (x !== undefined && y !== undefined) {
            x = Number(x);
            y = Number(y);
            const agent = levelManager.getVisibleAgent();
            if (agent) {
                agent.setCommand(x, y, params?.action || 'interact');
                return `Agent commanded to ${params?.action || 'interact'} at ${x},${y}.`;
            } else {
                return "No Agent found.";
            }
        }
    } else {
        return "Can't find the switch.";
    }
    return null;
};

// --- Registration ---

registerAction(ActionType.OPEN_DOOR, openDoorHandler);
registerAction(ActionType.TOGGLE_LIGHT, toggleLightHandler);
registerAction(ActionType.ASK_MODEL, askModelHandler);
registerAction(ActionType.FIND_SWITCH, findSwitchHandler);
registerAction(ActionType.MOVE_AGENT, moveAgenthHandler);

// We need a no-op handler for DESTROY_OBJECT if it's not implemented yet or remove it from types.
// The original code didn't implement DESTROY_OBJECT in executeActions switch case?
// Wait, looking at original file...
// ActionType.DESTROY_OBJECT was in enum but not in switch case.
// I'll ignore it for now or add a placeholder.
