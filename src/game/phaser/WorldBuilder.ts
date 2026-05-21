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
import { WorldData, Layout, Instance, AnimationObject, Layer } from '../core/WorldData';
import { CONSTANTS, InteractionType, BehaviourName, NPCMovementType } from '../core/Constants';
import { GridManager } from '../core/GridManager';
import { Player } from '../core/Player';
import { MovingNPC } from '../core/MovingNPC';
import { AgenticNPC } from '../core/AgenticNPC';
import { MovableObject } from '../core/MovableObject';

export interface BuiltLevel {
    gridManager: GridManager;
    player: Player;
    npcs: MovingNPC[];
    agents: AgenticNPC[];
    movables: MovableObject[];
    playerSprite: Phaser.GameObjects.Sprite;
    npcSprites: Map<MovingNPC, Phaser.GameObjects.Sprite>;
    movableSprites: Map<MovableObject, Phaser.GameObjects.Sprite>;
    mapObjects: Phaser.GameObjects.GameObject[];
}

export class WorldBuilder {
    protected worldData: WorldData;
    private scene: Scene;

    constructor(scene: Scene, worldData: WorldData) {
        this.scene = scene;
        this.worldData = worldData;
    }

    public build(layout: Layout): BuiltLevel {
        this.preloadTextures(layout);
        
        const config = this.worldData.unwrapConfig(layout.config);
        const pixelWidth = config.width || 1024;
        const pixelHeight = config.height || 1024;

        // Initialize Grid Logic
        const gridManager = new GridManager(pixelWidth, pixelHeight);
        
        const levelData = this.createLevelData(gridManager);

        this.onBuildStart(gridManager);

        // Process Layers
        layout.layers.forEach((layer, layerIndex) => {
             this.processLayer(layer, levelData, layerIndex);
        });

        // Create Player
        let startFound = false;
        let playerX = 0;
        let playerY = 0;

        for (const layer of layout.layers) {
            for (const inst of layer.instances) {
                const behaviours = this.worldData.resolveInstanceBehaviours(inst);
                if (behaviours.some((b: any) => b.type === InteractionType.START)) {
                    const props = this.worldData.resolveInstanceProperties(inst, layer);
                    playerX = props.x;
                    playerY = props.y;
                    startFound = true;
                    break;
                }
            }
            if (startFound) break;
        }

        if (!startFound) {
            const gridHeightPixels = gridManager.height * CONSTANTS.GRID_SIZE;
            const startPixel = gridManager.toPixel(CONSTANTS.PLAYER_SPAWN);
            playerX = startPixel;
            playerY = startPixel;
            if (this.worldData.isFlipY()) {
                playerY = gridHeightPixels - startPixel;
            }
        }

        levelData.player = new Player(playerX, playerY, gridManager, levelData.npcs, levelData.agents, this.worldData.isFlipY());
        
        // Create Player Visual
        this.createPlayerVisual(levelData, playerX, playerY);
        
        return levelData;
    }

    private preloadTextures(layout: Layout) {
        const texturesToLoad = new Set<string>();

        layout.layers.forEach(layer => {
            layer.instances.forEach(inst => {
                // Main texture
                const classDef = this.worldData.getClass(inst.inherit);
                const classImg = classDef?.config['image']?.value;
                const textureName = this.worldData.getTextureFile(classImg);
                if (textureName) texturesToLoad.add(textureName);

                // Animations
                const animations = this.worldData.resolveInstanceAnimations(inst);
                animations.forEach(anim => {
                    anim.frames.forEach(frame => {
                         const frameConfig = this.worldData.resolveFrameProperties(frame);
                         const frameTex = this.worldData.getTextureFile(frameConfig.image);
                         if (frameTex) texturesToLoad.add(frameTex);
                    });
                });
            });
        });

        let started = false;
        texturesToLoad.forEach(tex => {
            if (!this.scene.textures.exists(tex)) {
                this.scene.load.image(tex, tex);
                started = true;
            }
        });

        if (started) {
            this.scene.load.start();
        }
    }

    protected createLevelData(gridManager: GridManager): BuiltLevel {
        return {
            gridManager,
            player: null as any,
            playerSprite: null as any,
            npcs: [],
            agents: [],
            npcSprites: new Map(),
            movables: [],
            movableSprites: new Map(),
            mapObjects: []
        };
    }
    
    protected onBuildStart(gridManager: GridManager): void {
        this.scene.cameras.main.setBounds(0, 0, gridManager.width * CONSTANTS.GRID_SIZE, gridManager.height * CONSTANTS.GRID_SIZE);
    }

    protected createPlayerVisual(levelData: BuiltLevel, x: number, y: number): void {
        const frame1 = '../player-1.png';
        const frame2 = '../player-2.png';

        if (!this.scene.anims.exists('player-walk')) {
            this.scene.anims.create({
                key: 'player-walk',
                frames: [
                    { key: frame1 },
                    { key: frame2 }
                ],
                frameRate: 4,
                repeat: -1
            });
        }

        levelData.playerSprite = this.scene.add.sprite(x, y, frame1);
        levelData.playerSprite.setDepth(10);
        levelData.playerSprite.play('player-walk');
    }

    protected processLayer(layer: Layer, levelData: BuiltLevel, layerIndex: number) {
        layer.instances.forEach((inst: Instance) => {
            const props = this.worldData.resolveInstanceProperties(inst, layer);
            const behaviours = this.worldData.resolveInstanceBehaviours(inst);
            const animations = this.worldData.resolveInstanceAnimations(inst);

            let configName = inst.config['name']?.value;
            if (!configName) configName = props.name;

            const autoMovesBehaviour = behaviours.find((b: any) => b.autoMoves !== undefined);
            const autoMoves = autoMovesBehaviour ? parseInt(autoMovesBehaviour.autoMoves) : 0;
            const isMovable = behaviours.some((b: any) => b.type === InteractionType.MOVABLE);
            const portrait = this.getPortraitTexture(configName, animations);

            const pos = {
                x: props.x,
                y: props.y,
                z: props.z || 0
            };

            let currentNPC: MovingNPC | null = null;
            if (autoMoves > 0) {
                if (autoMoves === NPCMovementType.FOLLOW) {
                    let agent = new AgenticNPC(props, levelData.gridManager, autoMoves, portrait);
                    levelData.agents.push(agent);
                    currentNPC = agent;
                    this.createNPCVisual(inst, props, animations, behaviours, levelData, agent, pos, layerIndex);
                } else {
                    let npc = new MovingNPC(props, levelData.gridManager, autoMoves, portrait);
                    levelData.npcs.push(npc);
                    currentNPC = npc;

                    behaviours.forEach((b: any) => {
                        if (b.type == InteractionType.CHAT) {
                            b.origin = npc;
                        }
                    });
                    this.createNPCVisual(inst, props, animations, behaviours, levelData, npc, pos, layerIndex);
                }

            } else if (isMovable) {
                const movable = new MovableObject(props, levelData.gridManager);
                behaviours.forEach((b: any) => {
                    if (b.type == InteractionType.MOVABLE) {
                        movable.setContext(b.chatResponse);
                        if (b.linkURL) {
                            movable.setTargetNPC(b.linkURL);
                        }
                    }
                });
                levelData.movables.push(movable);

                // Register in movableMap
                const gx = levelData.gridManager.toGrid(props.x);
                const gy = levelData.gridManager.toGrid(props.y);
                levelData.gridManager.setMovable(gx, gy, movable);

                this.createMovableVisual(inst, props, animations, behaviours, levelData, movable, pos, layerIndex);
            } else {
                this.createObjectVisual(inst, props, animations, behaviours, levelData, pos, layerIndex);
            }

            // Logic Wiring
            this.registerGridLogic(inst, props, behaviours, configName, portrait, levelData.gridManager, currentNPC, animations);
        });
    }

    protected getPortraitTexture(configName: string, animations: AnimationObject[]) {
        // if (!animations) return null;
        // const portraitAnim = animations.find(a => 
        //     this.worldData.resolveAnimationProperties(a).name === "PORTRAIT"
        // );
        // const frame = portraitAnim?.frames.find(f => f.config['name'].value === configName);
        // const imageName = frame?.config['image'].value;
        // return imageName ? this.worldData.getTextureFile(imageName) : null;
        return null;
    }

    protected registerGridLogic(inst: Instance, props: any, behaviours: any[], configName: string, portrait: string | null | undefined, gridManager: GridManager, npc: MovingNPC | null = null, animations: AnimationObject[] = []) {
        const { startGx, endGx, startGy, endGy } = this.getGridBounds(props);

        const blockerBehaviour = behaviours.find((b: any) => b.name === BehaviourName.BLOCKER);
        const isBlocker = !!blockerBehaviour;
        const blockerType = blockerBehaviour?.type || 'full';
        const interactiveBehaviour = behaviours.find((b: any) => b.name === BehaviourName.INTERACTIVE);
        const isInteractive = !!interactiveBehaviour;

        const classDef = this.worldData.getClass(inst.inherit);
        const classImg = classDef?.config['image']?.value;
        let interactionImage = this.worldData.getTextureFile(classImg);
        if (portrait) interactionImage = portrait;

        for (let gx = startGx; gx <= endGx; gx++) {
            for (let gy = startGy; gy <= endGy; gy++) {
                if (isBlocker) gridManager.setBlocker(gx, gy, true, blockerType);

                if (isInteractive) {
                    interactiveBehaviour.persona = props.persona;
                    interactiveBehaviour.skill = props.skill;
                    this.registerInteraction(inst.id, gx, gy, interactiveBehaviour, configName, interactionImage, gridManager, npc, animations);
                }
            }
        }
    }

    protected registerInteraction(instanceId: string, gx: number, gy: number, b: any, configName: string, textureName: string | undefined, gridManager: GridManager, npc: MovingNPC | null = null, animations: AnimationObject[] = []) {
        let interactionData: any = null;
        let animFrames: string[] = [];
        if (animations && animations.length > 0) {
            const firstAnim = animations.find(a => this.worldData.resolveAnimationProperties(a).name !== 'PORTRAIT');
            if (firstAnim) {
                animFrames = firstAnim.frames.map((frame: any) => {
                    const frameConfig = this.worldData.resolveFrameProperties(frame);
                    return this.worldData.getTextureFile(frameConfig.image);
                }).filter(Boolean) as string[];
            }
        }

        switch (b.type) {
        case InteractionType.CHAT:
        case InteractionType.TREASURE:
        case InteractionType.SWITCH:
        case InteractionType.AI_NPC:
            interactionData = {
                ...b,
                name: configName,
                image: textureName,
                animFrames: animFrames,
                instanceId: instanceId
            };
            break;
        case InteractionType.COLLECTIBLE:
            interactionData = {
                ...b,
                name: configName,
                image: textureName,
                tag: configName,
                instanceId: instanceId,
            };
            break;

        case InteractionType.LINK:
            interactionData = {
                ...b,
                linkName: configName
            };
            break;

        case InteractionType.START:
        case InteractionType.DOOR:
        case InteractionType.MOVABLE:
            break;

        case InteractionType.MODEL:
        case InteractionType.CODE:
        case InteractionType.BUILD:
        case InteractionType.DRAW:
            gridManager.setModelToolMap(gx, gy, b);
            return;
            
        default:
            if (b.type) {
                interactionData = b;
            }
        }

        if (interactionData) {
            if (npc) {
                npc.interaction = interactionData;
            } else {
                gridManager.setInteraction(gx, gy, interactionData);
            }
        }
    }

    protected getGridBounds(props: any) {
        const halfWidth = props.width / 2;
        const halfHeight = props.height / 2;

        return {
            startGx: Math.floor((props.x - halfWidth) / CONSTANTS.GRID_SIZE),
            endGx: Math.floor((props.x + halfWidth - 0.01) / CONSTANTS.GRID_SIZE),
            startGy: Math.floor((props.y - halfHeight) / CONSTANTS.GRID_SIZE),
            endGy: Math.floor((props.y + halfHeight - 0.01) / CONSTANTS.GRID_SIZE)
        };
    }

    protected createNPCVisual(inst: Instance, props: any, animations: AnimationObject[], behaviours: any[], levelData: BuiltLevel, npc: MovingNPC, pos: {x: number, y: number, z: number}, layerIndex: number): void {
        const classDef = this.worldData.getClass(inst.inherit);
        const classImg = classDef?.config['image']?.value;
        const textureName = this.worldData.getTextureFile(classImg);
        
        if (textureName) {
            const sprite = this.scene.add.sprite(pos.x, pos.y, textureName);
            sprite.setDisplaySize(props.width, props.height);
            sprite.setDepth(pos.z || 0); 
            sprite.setFlip(props.flipX, props.flipY);
            
            this.addAnimation(sprite, inst, animations);
            
            levelData.npcSprites.set(npc, sprite);
        }
    }

    protected createMovableVisual(inst: Instance, props: any, animations: AnimationObject[], behaviours: any[], levelData: BuiltLevel, movable: MovableObject, pos: {x: number, y: number, z: number}, layerIndex: number): void {
        const classDef = this.worldData.getClass(inst.inherit);
        const classImg = classDef?.config['image']?.value;
        const textureName = this.worldData.getTextureFile(classImg);

        if (textureName) {
            const sprite = this.scene.add.sprite(pos.x, pos.y, textureName);
            sprite.setDisplaySize(props.width, props.height);
            sprite.setDepth(pos.z || 0);
            sprite.setFlip(props.flipX, props.flipY);
            sprite.setName(props.name || '');
            
            this.addAnimation(sprite, inst, animations);
            
            levelData.movableSprites.set(movable, sprite);
            levelData.mapObjects.push(sprite); 
        }
    }

    protected createObjectVisual(inst: Instance, props: any, animations: AnimationObject[], behaviours: any[], levelData: BuiltLevel, pos: {x: number, y: number, z: number}, layerIndex: number): void {
        let texture = 'unknown'; 
        const classDef = this.worldData.getClass(inst.inherit);
        
        const classImg = classDef?.config['image']?.value;
        const textureName = this.worldData.getTextureFile(classImg);
        
        if (textureName) {
            texture = textureName;
        }

        var gameObject;
        if (animations.length > 0) {
            gameObject = this.scene.add.sprite(pos.x, pos.y, texture);
            this.addAnimation(gameObject, inst, animations);
        } else {
            gameObject = this.scene.add.image(pos.x, pos.y, texture);
        }

        gameObject.setDisplaySize(props.width, props.height);
        gameObject.setDepth(pos.z || 0);
        gameObject.setFlip(props.flipX, props.flipY);

        if(props.visible == false) {
            gameObject.setVisible(false);
        }

        (gameObject as any).classId = inst.inherit;
        (gameObject as any).instanceId = inst.id;
        (gameObject as any).props = props;
        levelData.mapObjects.push(gameObject);
    }

    private addAnimation(sprite: Phaser.GameObjects.Sprite, inst: any, animations: AnimationObject[]) {
        if (animations.length > 0) {
            let firstAnim = null;
            animations.forEach(anim => {
                const animConfig = this.worldData.resolveAnimationProperties(anim);
                const animName = animConfig.name || 'default';
                const animKey = `${inst.inherit}_${animName}`;

                switch (animName) {
                case "PORTRAIT":
                    break;
                default:
                    firstAnim = anim;
                    if (!this.scene.anims.exists(animKey)) {
                        const frames = anim.frames.map((frame: any) => {
                            const frameConfig = this.worldData.resolveFrameProperties(frame);
                            const frameTex = this.worldData.getTextureFile(frameConfig.image);
                            if (frameTex) {
                                return { key: frameTex };
                            }
                            return null;
                        }).filter((f: any) => f !== null) as Phaser.Types.Animations.AnimationFrame[];

                        this.scene.anims.create({
                            key: animKey,
                            frames: frames,
                            frameRate: animConfig.fps || 10,
                            repeat: -1
                        });
                    }
                    break;
                }
            });

            if (firstAnim) {
                const firstAnimConfig = this.worldData.resolveAnimationProperties(firstAnim);
                const playKey = `${inst.inherit}_${firstAnimConfig.name || 'default'}`;
                (sprite as Phaser.GameObjects.Sprite).play(playKey);
            }
        }       
    }
    
    public generateDefaultTextures() {
        this.worldData.getTextureList()?.forEach(t => {
            const name = t.config["md5"]?.value;
            if (name) this.scene.load.image(name, name);
        });

        const frame1 = '../player-1.png';
        const frame2 = '../player-2.png';

        let started = false;
        if (!this.scene.textures.exists(frame1)) {
            this.scene.load.image(frame1, frame1);
            started = true;
        }
        if (!this.scene.textures.exists(frame2)) {
            this.scene.load.image(frame2, frame2);
            started = true;
        }

        if (started) {
            this.scene.load.start();
        }

        if (!this.scene.textures.exists('player')) {
            const graphics = this.scene.make.graphics({ x: 0, y: 0 });
            graphics.fillStyle(CONSTANTS.colors.PLAYER);
            graphics.fillRect(0, 0, 32, 32);
            graphics.fillStyle(CONSTANTS.colors.EYES);
            graphics.fillRect(8, 8, 6, 6);
            graphics.fillRect(20, 8, 6, 6);
            graphics.generateTexture('player', 32, 32);
            graphics.destroy();
        }
    }
}
