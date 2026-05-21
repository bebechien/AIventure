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

import { Rule, TriggerType, ActionType } from './TriggerTypes';

export const PUZZLE_RULES: Rule[] = [
    // Apple Puzzle
    {
        id: 'apple_puzzle',
        trigger: (ctx) => ctx.type === TriggerType.MOVABLE_LANDED && ctx.subject?.name === 'Apple',
        actions: [
            { type: ActionType.OPEN_DOOR, params: { color: 'Apple' } }
        ]
    },
    // Scroll Puzzle
    {
        id: 'scroll_puzzle',
        trigger: (ctx) => ctx.type === TriggerType.MOVABLE_LANDED && ctx.subject?.name === 'Scroll',
        actions: [
            { type: ActionType.ASK_MODEL, params: { prompt: "What's the code?" } }
        ]
    },
    // Light Switch
    {
        id: 'light_switch',
        trigger: (ctx) => ctx.type === TriggerType.INTERACTION && ctx.payload?.linkURL === 'light',
        actions: [
            { type: ActionType.TOGGLE_LIGHT },
            { type: ActionType.OPEN_DOOR, params: { color: 'light' } }
        ]
    },
    // Generic Door Switch (Color)
    {
        id: 'door_switch',
        trigger: (ctx) => ctx.type === TriggerType.INTERACTION && ctx.payload?.linkURL && ctx.payload.linkURL !== 'light',
        actions: [
            { type: ActionType.OPEN_DOOR, params: { usePayload: true } } // Special param to use linkURL
        ]
    },
    // [START solution_code]
    // Model: Open Door
    {
        id: 'model_open_door',
        trigger: (ctx) => ctx.type === TriggerType.MODEL_FUNCTION && ctx.payload?.name.startsWith('open_'),
        actions: [
            { type: ActionType.OPEN_DOOR, params: { extractFromFunctionName: '_' } }
        ]
    },
    // [END solution_code]
    // Model: Light On
    {
        id: 'model_light_on',
        trigger: (ctx) => ctx.type === TriggerType.MODEL_FUNCTION && ctx.payload?.name === 'light_on',
        actions: [
            { type: ActionType.TOGGLE_LIGHT }
        ]
    },
    // Code Puzzle Success
    {
        id: 'code_puzzle_success',
        trigger: (ctx) => ctx.type === TriggerType.CODE_EXECUTED && ctx.payload?.result === 5050,
        actions: [
            { type: ActionType.OPEN_DOOR, params: { usePayload: true } }
        ]
    },
    // HTML Puzzle Success
    {
        id: 'html_puzzle_success',
        trigger: (ctx) => ctx.type === TriggerType.HTML_PUZZLE_SOLVED,
        actions: [
            { type: ActionType.OPEN_DOOR, params: { usePayload: true } }
        ]
    },
    // Draw Puzzle Success
    {
        id: 'draw_puzzle_success',
        trigger: (ctx) => ctx.type === TriggerType.DRAW_PUZZLE_SOLVED,
        actions: [
            { type: ActionType.OPEN_DOOR, params: { usePayload: true } }
        ]
    },
     // NPC Skill: Find Switch
     {
        id: 'npc_find_switch',
        trigger: (ctx) => ctx.type === TriggerType.MODEL_FUNCTION && ctx.payload?.name === 'find_switch',
        actions: [
            { type: ActionType.FIND_SWITCH }
        ]
    },
    // NPC Skill: Handle Switch
    {
        id: 'npc_move_to',
        trigger: (ctx) => ctx.type === TriggerType.MODEL_FUNCTION && ctx.payload?.name === 'move_to',
        actions: [
            { type: ActionType.MOVE_AGENT, params: { usePayload: true } }
        ]
    },
];
