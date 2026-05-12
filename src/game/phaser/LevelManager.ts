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

import { Scene } from 'phaser';
import { WorldData, Layout } from '../core/WorldData';
import { GridManager } from '../core/GridManager';
import { Player } from '../core/Player';
import { MovingNPC } from '../core/MovingNPC';
import { AgenticNPC } from '../core/AgenticNPC';
import { MovableObject } from '../core/MovableObject';
import { WorldBuilder, BuiltLevel } from './WorldBuilder';
import { ILevelManager, IGameObject } from '../core/Interfaces';
import { EventBus } from '../core/EventBus';
import { CONSTANTS, InteractionType } from '../core/Constants';

export class LevelManager implements ILevelManager
{
    protected worldData: WorldData;
    protected worldBuilder: WorldBuilder;

    public gridManager!: GridManager;
    public player!: Player;
    public npcs: MovingNPC[] = [];
    public agents: AgenticNPC[] = [];
    public movables: MovableObject[] = [];

    public currentLayoutName: string = '';
    public currentRoomX: number = 0;
    public currentRoomY: number = 0;

    public collectiblesTracker: any = {};

    private scene: Scene;

    public playerSprite!: Phaser.GameObjects.Sprite;
    public npcSprites: Map<MovingNPC, Phaser.GameObjects.Sprite> = new Map();
    public movableSprites: Map<MovableObject, Phaser.GameObjects.Sprite> = new Map();
    public mapObjects: (Phaser.GameObjects.GameObject & { props?: any, instanceId?: string })[] = [];

    private gameSize: { width: number, height: number } = { width: 1024, height: 768 };

    constructor(scene: Scene, worldData: WorldData, worldBuilder: WorldBuilder)
    {
        this.worldData = worldData;
        this.worldBuilder = worldBuilder;
        this.scene = scene;
    }

    public setGameSize(width: number, height: number)
    {
        this.gameSize = { width, height };
        this.updateCameraTarget();
    }

    public getGameSize()
    {
        return this.scene.scale.gameSize;
    }

    public changeLayout(layoutName: string)
    {
        const layout = this.worldData.getLayoutByName(layoutName);
        if (!layout)
        {
            console.warn(`Layout not found: ${layoutName}`);
            return;
        }

        const previousLayoutName = this.currentLayoutName;
        this.cleanup();
        this.buildLevel(layout);

        if (previousLayoutName)
        {
            const returnPortalPos = this.findPortalPosition(layout, previousLayoutName);
            if (returnPortalPos)
            {
                const validSpot = this.findValidSpawnNear(returnPortalPos.gx, returnPortalPos.gy);
                if (validSpot)
                {
                    const pixelX = this.gridManager.toPixel(validSpot.gx);
                    const pixelY = this.gridManager.toPixel(validSpot.gy);
                    this.player.setPosition(pixelX, pixelY);
                    this.onPlayerPositionReset(pixelX, pixelY);
                    this.updateCameraTarget();
                } else
                {
                    console.warn("No valid spawn spot near return portal.");
                }
            } else
            {
                console.warn(`Return portal to ${previousLayoutName} not found in ${layoutName}. Using default spawn.`);
            }
        }
    }

    public buildLevel(layout: Layout)
    {
        const builtLevel = this.worldBuilder.build(layout);

        this.gridManager = builtLevel.gridManager;
        this.player = builtLevel.player;
        this.npcs = builtLevel.npcs;
        this.agents = builtLevel.agents;
        this.movables = builtLevel.movables;

        const config = this.worldData.unwrapConfig(layout.config);
        this.currentLayoutName = config.name;

        this.onLevelBuilt(builtLevel);

        // Init Room
        const { width, height } = this.getGameSize();
        this.currentRoomX = Math.floor(this.player.x / width);
        this.currentRoomY = Math.floor(this.player.y / height);

        // Lock player briefly
        this.player.setLocked(true);
        setTimeout(() =>
        {
            if (this.player) this.player.setLocked(false);
        }, 250);

        this.updateCameraTarget();
        this.checkVisibleInteractions();
        this.prepareCollectibles(layout);
    }

    public update(time: number, delta: number)
    {
        const { width, height } = this.gameSize;

        // Only update NPCs in the current room
        this.npcs.forEach(npc =>
        {
            const [npcRoomX, npcRoomY] = this.getRoomCoordinate(npc.x, npc.y);
            if (npcRoomX === this.currentRoomX && npcRoomY === this.currentRoomY)
            {
                npc.updateNPC(time, delta, this.player);
            }
        });
        this.agents.forEach(agent =>
        {
            const [npcRoomX, npcRoomY] = this.getRoomCoordinate(agent.x, agent.y);
            if (npcRoomX === this.currentRoomX && npcRoomY === this.currentRoomY)
            {
                agent.updateNPC(time, delta, this.player);
            }
        })
    }

    protected cleanup()
    {
        this.npcs.forEach(npc => npc.destroy()); // clear logic listeners
        this.agents.forEach(npc => npc.destroy()); // clear logic listeners
        this.npcSprites.forEach(sprite => sprite.destroy());
        this.npcSprites.clear();
        this.npcs = [];
        this.agents = [];

        this.movables.forEach(m => m.destroy());
        this.movableSprites.forEach(sprite => sprite.destroy());
        this.movableSprites.clear();
        this.movables = [];

        this.mapObjects.forEach(obj => obj.destroy());
        this.mapObjects = [];

        if (this.player)
        {
            this.player.destroy(); // clear listeners
        }
        if (this.playerSprite)
        {
            this.playerSprite.destroy();
        }
    }

    protected wireNPCMovement(npc: MovingNPC)
    {
        const sprite = this.npcSprites.get(npc);
        if (sprite)
        {
            npc.on('move', (data: any) =>
            {
                this.scene.tweens.add({
                    targets: sprite,
                    x: data.x,
                    y: data.y,
                    duration: data.duration,
                    ease: 'Linear',
                    onComplete: data.onComplete
                });
            });
        }
    }

    protected wireAgentMovement(agent: AgenticNPC)
    {
        this.wireNPCMovement(agent);
        const sprite = this.npcSprites.get(agent);
        if (sprite)
        {
            agent.on('thought', (data: any) =>
            {
                // Extract Camera and Scaling context
                const cam = this.scene.cameras.main;
                const zoom = window.innerHeight / CONSTANTS.GAME_LOGICAL_HEIGHT;

                // Calculate the world-space offset
                const worldOffsetX = data.x - cam.midPoint.x;
                const worldOffsetY = data.y - cam.midPoint.y - (CONSTANTS.GRID_SIZE / 2);

                // Project to Screen Space
                // We use window dimensions and zoom to map the relative world units to pixels
                const x = (window.innerHeight / 2) + (worldOffsetX * zoom);
                const y = (window.innerHeight / 2) + (worldOffsetY * zoom);
                console.log(data.name, x, y);

                EventBus.emit('thought-bubble-update', {
                    id: data.name || agent.props.name || 'npc_' + agent.x,
                    text: data.text,
                    screenX: x,
                    screenY: y,
                    duration: data.duration
                });
            });
        }
    }

    protected wireMovableMovement(movable: MovableObject)
    {
        const sprite = this.movableSprites.get(movable);
        if (sprite)
        {
            movable.on('move', (data: any) =>
            {
                this.scene.tweens.add({
                    targets: sprite,
                    x: data.x,
                    y: data.y,
                    duration: data.duration,
                    ease: 'Cubic.out',
                    onComplete: data.onComplete
                });
            });

            movable.on('reset', (x: number, y: number) =>
            {
                sprite?.setPosition(x, y);
                this.scene.tweens.killTweensOf(sprite as any);
            });
        }
    }

    protected onLevelBuilt(builtLevel: BuiltLevel): void
    {
        this.playerSprite = builtLevel.playerSprite;
        this.npcSprites = builtLevel.npcSprites;
        this.movableSprites = builtLevel.movableSprites;
        this.mapObjects = builtLevel.mapObjects;

        // --- Wire up Player Events ---
        this.player.on('move', (data: any) =>
        {
            if (data.x < this.playerSprite.x) {
                this.playerSprite.setFlipX(true);
            } else if (data.x > this.playerSprite.x) {
                this.playerSprite.setFlipX(false);
            }

            let tweenConfig: any = {
                targets: this.playerSprite,
                x: data.x,
                y: data.y,
                duration: data.duration,
                onComplete: data.onComplete
            };

            if (data.type === 'bump')
            {
                tweenConfig.yoyo = true;
                tweenConfig.ease = 'Circ';
            } else
            {
                tweenConfig.ease = 'Back';
            }
            this.scene.tweens.add(tweenConfig);
        });

        this.player.on('position-changed', (x: number, y: number) =>
        {
            this.playerSprite.setPosition(x, y);
        });

        this.player.on('move-complete', () => this.updateCameraTarget());

        // --- Wire up NPC Events ---
        this.npcs.forEach(npc => { this.wireNPCMovement(npc); });
        this.agents.forEach(agent => { this.wireAgentMovement(agent); });

        // --- Wire up Movable Events ---
        this.movables.forEach(movable => { this.wireMovableMovement(movable); });
    }

    protected onPlayerPositionReset(x: number, y: number): void
    {
        this.updateCameraTarget();
    }

    protected getRoomCoordinate(x: number, y: number)
    {
        const screenW = this.gameSize.width;
        const screenH = this.gameSize.height;

        // Shift camera target by remaining height to align with bottom-left of the room
        // 2048 % 384 = 128 (4 tiles)
        const levelHeight = this.worldData.getLayoutByName(this.currentLayoutName)?.config['height'].value || 1024;
        const offset = levelHeight % screenH;

        return [Math.floor(x / screenW), Math.floor((y - offset) / screenH)];
    }

    public updateCameraTarget()
    {
        if (!this.player) return;

        const screenW = this.gameSize.width;
        const screenH = this.gameSize.height;

        // Shift camera target by remaining height to align with bottom-left of the room
        // 2048 % 384 = 128 (4 tiles)
        const levelHeight = this.worldData.getLayoutByName(this.currentLayoutName)?.config['height'].value || 1024;
        const offset = levelHeight % screenH;

        const [roomX, roomY] = this.getRoomCoordinate(this.player.x, this.player.y);

        // Check for Room Change
        if (roomX !== this.currentRoomX || roomY !== this.currentRoomY)
        {
            console.log("Room changed! Resetting movables and agents...");
            this.movables.forEach(m => m.reset());
            this.agents.forEach(a => a.reset());
            this.currentRoomX = roomX;
            this.currentRoomY = roomY;
            this.checkVisibleInteractions();
        }

        const camX = roomX * screenW;
        const camY = roomY * screenH + offset;

        if (this.scene.cameras.main.scrollX !== camX || this.scene.cameras.main.scrollY !== camY)
        {
            this.scene.cameras.main.pan(
                camX + screenW / 2,
                camY + screenH / 2,
                500,
                'Expo.easeOut',
                true
            );
        }
    }

    public removeObject(instanceId: string)
    {
        const object = this.getObjectById(instanceId);
        if (object)
        {
            const bounds = this.getGridBounds(object.props);

            for (let gx = bounds.startGx; gx <= bounds.endGx; gx++)
            {
                for (let gy = bounds.startGy; gy <= bounds.endGy; gy++)
                {
                    this.gridManager.setBlocker(gx, gy, false);
                    this.gridManager.setModelToolMap(gx, gy, null);

                }
            }

            this.gridManager.removeObject(this.gridManager.toGrid(object.props.x), this.gridManager.toGrid(object.props.y));
            object.destroy();

            this.mapObjects = this.mapObjects.filter(obj => obj.instanceId !== instanceId);

        }
    }

    public getObjectById(id: string): IGameObject | null
    {
        return this.mapObjects.find(obj =>
        {
            return obj.instanceId === id;
        }) || null;
    }

    public flipObject(instanceId: string)
    {
        const obj = this.getObjectById(instanceId);
        if (obj && (obj as any).setFlipX)
        {
            (obj as any).setFlipX(!(obj as any).flipX);
        }
    }

    public getObjectsByTag(tag: string): IGameObject[]
    {
        return this.mapObjects.filter(obj =>
        {
            const props = (obj as any).props;
            return props && props.name === tag;
        });
    }

    private getGridBounds(props: any)
    {
        const halfWidth = props.width / 2;
        const halfHeight = props.height / 2;

        return {
            startGx: Math.floor((props.x - halfWidth) / CONSTANTS.GRID_SIZE),
            endGx: Math.floor((props.x + halfWidth - 0.01) / CONSTANTS.GRID_SIZE),
            startGy: Math.floor((props.y - halfHeight) / CONSTANTS.GRID_SIZE),
            endGy: Math.floor((props.y + halfHeight - 0.01) / CONSTANTS.GRID_SIZE)
        };
    }

    private removeMapObjectByTag(tag: string, shouldClearGrid: (gx: number, gy: number) => boolean = () => true)
    {
        const objectsToRemove = this.getObjectsByTag(tag);

        objectsToRemove.forEach(obj =>
        {
            const props = (obj as any).props;
            if (props)
            {
                const bounds = this.getGridBounds(props);

                for (let gx = bounds.startGx; gx <= bounds.endGx; gx++)
                {
                    for (let gy = bounds.startGy; gy <= bounds.endGy; gy++)
                    {
                        if (shouldClearGrid(gx, gy))
                        {
                            this.gridManager.setBlocker(gx, gy, false);
                            this.gridManager.setModelToolMap(gx, gy, null);
                        }
                    }
                }

                obj.destroy();
            }
        });

        this.mapObjects = this.mapObjects.filter(obj => !objectsToRemove.includes(obj));
    }

    public checkVisibleInteractions()
    {
        let model_tools: any[] = [];
        this.getVisibleModelTools(InteractionType.MODEL).forEach(tools =>
        {
            const tool_name = tools.chatResponse;
            if (tool_name && !model_tools.includes(tool_name))
            {
                model_tools.push(tool_name);
            }
        });

        const toolObj = model_tools.map((funcName: string) => ({
            name: funcName,
            description: `Function to handle ${funcName}`
        }));

        EventBus.emit('visible-interactions', toolObj);

        // Chat interactions
        const chatInteractions = this.getVisibleInteractions(InteractionType.CHAT);
        if (chatInteractions.length > 0)
        {
            EventBus.emit('visible-npcs', chatInteractions);
        } else
        {
            EventBus.emit('visible-npcs', null);
        }

        // Check for CODE interactions
        const codeInteractions = this.getVisibleModelTools(InteractionType.CODE);
        if (codeInteractions.length > 0)
        {
            EventBus.emit('visible-code-interaction', codeInteractions[0]);
        } else
        {
            EventBus.emit('visible-code-interaction', null);
        }

        // Check for BUILD interactions
        const buildInteractions = this.getVisibleModelTools(InteractionType.BUILD);
        if (buildInteractions.length > 0)
        {
            EventBus.emit('visible-build-interaction', buildInteractions[0]);
        } else
        {
            EventBus.emit('visible-build-interaction', null);
        }
    }

    public getVisibleAgent(): AgenticNPC | null
    {
        if (!this.player || !this.gridManager) return null;

        const [roomX, roomY] = this.getRoomCoordinate(this.player.x, this.player.y);

        for (const agent of this.agents)
        {
            const [npcRoomX, npcRoomY] = this.getRoomCoordinate(agent.x, agent.y);
            if (npcRoomX === roomX && npcRoomY === roomY)
            {
                return agent;
            }
        }

        return null;
    }

    public getVisibleInteractions(type: any = null): any[]
    {
        if (!this.player || !this.gridManager) return [];

        const { width, height } = this.getGameSize();
        const screenW = width;
        const screenH = height;

        // Shift camera target by remaining height to align with bottom-left of the room
        // 2048 % 384 = 128 (4 tiles)
        const levelHeight = this.worldData.getLayoutByName(this.currentLayoutName)?.config['height'].value || 1024;
        const offset = levelHeight % screenH;

        const roomX = Math.floor(this.player.x / screenW);
        const roomY = Math.floor((this.player.y - offset) / screenH);

        const startPixelX = roomX * screenW;
        const startPixelY = roomY * screenH + offset;
        const endPixelX = startPixelX + screenW;
        const endPixelY = startPixelY + screenH;

        const startGx = Math.floor(startPixelX / CONSTANTS.GRID_SIZE);
        const endGx = Math.ceil(endPixelX / CONSTANTS.GRID_SIZE);
        const startGy = Math.floor(startPixelY / CONSTANTS.GRID_SIZE);
        const endGy = Math.ceil(endPixelY / CONSTANTS.GRID_SIZE);

        const visibleInteractions: any[] = [];

        for (let gy = startGy; gy < endGy; gy++)
        {
            for (let gx = startGx; gx < endGx; gx++)
            {
                const interaction = this.gridManager.getInteraction(gx, gy);
                if (interaction && (!type || interaction.type === type))
                {
                    visibleInteractions.push({
                        ...interaction,
                        gridX: gx,
                        gridY: gy
                    });
                }
            }
        }

        return visibleInteractions;
    }

    public getVisibleModelTools(type: any = null): any[]
    {
        if (!this.player || !this.gridManager) return [];

        const { width, height } = this.getGameSize();
        const screenW = width;
        const screenH = height;

        // Shift camera target by remaining height to align with bottom-left of the room
        // 2048 % 384 = 128 (4 tiles)
        const levelHeight = this.worldData.getLayoutByName(this.currentLayoutName)?.config['height'].value || 1024;
        const offset = levelHeight % screenH;

        const roomX = Math.floor(this.player.x / screenW);
        const roomY = Math.floor((this.player.y - offset) / screenH);

        const startPixelX = roomX * screenW;
        const startPixelY = roomY * screenH + offset;
        const endPixelX = startPixelX + screenW;
        const endPixelY = startPixelY + screenH;

        const startGx = Math.floor(startPixelX / CONSTANTS.GRID_SIZE);
        const endGx = Math.ceil(endPixelX / CONSTANTS.GRID_SIZE);
        const startGy = Math.floor(startPixelY / CONSTANTS.GRID_SIZE);
        const endGy = Math.ceil(endPixelY / CONSTANTS.GRID_SIZE);

        const visibleTools: any[] = [];

        for (let gy = startGy; gy < endGy; gy++)
        {
            for (let gx = startGx; gx < endGx; gx++)
            {
                const interaction = this.gridManager.getModelToolMap(gx, gy);
                if (interaction && (!type || interaction.type === type))
                {
                    visibleTools.push({
                        ...interaction,
                        gridX: gx,
                        gridY: gy
                    });
                }
            }
        }

        return visibleTools;
    }

    private findPortalPosition(layout: Layout, targetLink: string): { gx: number, gy: number } | null
    {
        let bestPos: { gx: number, gy: number } | null = null;

        for (const layer of layout.layers)
        {
            for (const inst of layer.instances)
            {
                const behaviours = this.worldData.resolveInstanceBehaviours(inst);
                const portalBehaviour = behaviours.find((b: any) =>
                    b.type === InteractionType.PORTAL && b.linkURL?.toLowerCase() === targetLink.toLowerCase()
                );

                if (portalBehaviour)
                {
                    const props = this.worldData.resolveInstanceProperties(inst, layer);
                    const gx = Math.floor(props.x / CONSTANTS.GRID_SIZE);
                    const gy = Math.floor(props.y / CONSTANTS.GRID_SIZE);

                    // If we haven't found a pos yet, OR if this new gx is smaller than the current best
                    if (!bestPos || gx < bestPos.gx)
                    {
                        bestPos = { gx, gy };
                    }
                }
            }
        }
        return bestPos;
    }

    private findValidSpawnNear(gx: number, gy: number): { gx: number, gy: number } | null
    {
        const neighbors = [
            { dx: 0, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }
        ];

        for (const offset of neighbors)
        {
            const targetGx = gx + offset.dx;
            const targetGy = gy + offset.dy;
            if (!this.gridManager.isBlocked(targetGx, targetGy))
            {
                return { gx: targetGx, gy: targetGy };
            }
        }
        return null;
    }

    private prepareCollectibles(layout: Layout)
    {

        for (const layer of layout.layers)
        {
            for (const inst of layer.instances)
            {
                const behaviours = this.worldData.resolveInstanceBehaviours(inst);
                const collectibleBehaviour = behaviours.find((b: any) =>
                    b.type === InteractionType.COLLECTIBLE
                );

                var name = this.worldData.getValueByKey(inst.id, 'name');

                if (collectibleBehaviour && typeof name != 'undefined')
                {
                    if (!(name in this.collectiblesTracker))
                    {
                        this.collectiblesTracker[name] = { max: 0, count: 0 };
                    }

                    this.collectiblesTracker[name].max += 1;
                }
            }
        }

        console.log(this.collectiblesTracker);
        EventBus.emit('collectibles-tracker', this.collectiblesTracker);
    }

    public triggerCollectible(name: string)
    {
        if (name in this.collectiblesTracker)
        {
            this.collectiblesTracker[name].count += 1;

            if (this.collectiblesTracker[name].count == this.collectiblesTracker[name].max)
            {
                // TODO: trigger event for all collectibles collected
            }

            EventBus.emit('collectibles-tracker', this.collectiblesTracker);
            EventBus.emit('collectible-collected', { name });
        }
    }

}