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

export enum TriggerType {
    MOVABLE_LANDED = 'MOVABLE_LANDED',
    INTERACTION = 'INTERACTION',
    MODEL_FUNCTION = 'MODEL_FUNCTION',
    CODE_EXECUTED = 'CODE_EXECUTED',
    HTML_PUZZLE_SOLVED = 'HTML_PUZZLE_SOLVED',
    DRAW_PUZZLE_SOLVED = 'DRAW_PUZZLE_SOLVED'
}

export enum ActionType {
    DESTROY_OBJECT = 'DESTROY_OBJECT',
    ASK_MODEL = 'ASK_MODEL',
    TOGGLE_LIGHT = 'TOGGLE_LIGHT',
    OPEN_DOOR = 'OPEN_DOOR',
    FIND_SWITCH = 'FIND_SWITCH',
    MOVE_AGENT = 'MOVE_AGENT'
}

export interface TriggerContext {
    type: TriggerType;
    subject?: any; // The object causing the event (e.g. Movable)
    target?: any;  // The object being interacted with (e.g. Slot, Switch)
    payload?: any; // Extra data (e.g. linkURL, function name)
}

export interface Action {
    type: ActionType;
    params?: any;
}

export interface Rule {
    id: string;
    trigger: (context: TriggerContext) => boolean;
    actions: Action[];
}
