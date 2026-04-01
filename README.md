# AIventure

A 2D grid-based adventure game built with [Phaser 3](https://phaser.io/) and [Angular](https://angular.io/).

## Overview

AIventure is a top-down exploration game where players navigate a grid-based world, interact with objects, and explore different rooms. The project demonstrates how to integrate Phaser game instances within an Angular application, handling communication between the frameworks.

## Features

*   **Angular Integration:** Seamless embedding of game scenes within Angular components.
*   **Phaser 3 Renderer:** Optimized 2D Pixel Art rendering.
*   **Decoupled Architecture:** Core game logic (Entities, Grid, Physics) is completely separated from rendering code, located in `src/game/core/`.
*   **Data-Driven World:** Game levels, classes, and behaviors are loaded from external JSON data (`WorldData`).
*   **Grid-Based Movement:** Precise tile-based player movement and collision detection.
*   **Zelda-Style Camera:** Camera transitions between screen-sized rooms.
*   **Interactive Objects:** Support for blockers, chat interactions, and external links.
*   **Smart NPCs:** Autonomous characters that can patrol, follow the player, or execute AI-driven commands.
*   **Dual AI Integration:** Seamlessly powered by **Google Gemini** and **Gemma** to drive sophisticated NPC dialogues and dynamic puzzle-solving logic.

## UI in Angular

The UI is divided into 3 major sections:

*   **Left Panel:** Contains the "AIventure" header and a chat interface that displays messages from the game.
*   **Middle Panel:** A container centered in the page, hosting the active game instance (Phaser).
*   **Right Panel:** Features a tabbed interface with sections for Comments, Code, iFrame, and Logs.

## Project Structure

*   `src/app/`: Contains the Angular application logic.
    *   `components/`: UI components (chat, panels, modals).
    *   `phaser-game.component.ts`: The main wrapper component for the game view.
    *   `app.component.ts`: The main application orchestrator.
*   `src/game/`: Contains the game engine code.
    *   `core/`: **Renderer-Agnostic Logic**.
        *   `WorldData.ts`: Handles loading and parsing of game configuration.
        *   `GridManager.ts`: Manages the game grid and collisions.
        *   `Player.ts`, `NPC.ts`, `MovableObject.ts`: Pure logic entities.
        *   `BaseWorldBuilder.ts`, `BaseLevelManager.ts`: Base classes for world generation and level management.
        *   `InteractionSystem.ts`: Handles high-level game interactions.
        *   `trigger/`: **Rule-Based Trigger System**.
            *   `TriggerSystem.ts`: Core processing engine.
            *   `PuzzleRules.ts`: Game rules configuration.
            *   `actions/`: Action implementations.
        *   `EventBus.ts`: Central communication hub.
    *   `phaser/`: **Phaser 3 Implementation**.
        *   `scenes/`: Phaser scenes (Boot, Preloader, Game).
        *   `WorldBuilder.ts`, `LevelManager.ts`: Phaser-specific implementations extending Core base classes.

## Development

### Prerequisites

*   Node.js and npm installed.

### Installation

```bash
npm install
```

### Run Development Server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

```bash
npm run dev
```

### Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

```bash
npm run build
```

### Sprite pack license / credits

Several sprites for this project were licensed from the Oryx Design Lab's Wee Fantasy sprite pack: https://www.oryxdesignlab.com/products/p/wee-fantasy 

The following sprites are from Oryx Design Lab without modifications:
- public/asssets/gamedata/8b7184c09a3cb22e00aa0bcd7ec8d4f3
- public/asssets/gamedata/11d3f592d3ff0991b0e4d3db7a8adebe
- public/asssets/gamedata/b0873eff9ce99b80e42e5a20c402e089
- public/asssets/gamedata/a951de827675a34a0009b6e49022a51c
- public/asssets/gamedata/187559f92ec289ff41b415a3e1ef400a
- public/asssets/gamedata/d7d88f56f462752fb26411f92b04b3f0
- public/asssets/gamedata/d80ea02d00d191411567c3016f946145
- public/asssets/gamedata/f275e398f417046bf856d20c5715172d
- public/asssets/gamedata/f5f6093ff99e272b1164c3b1e31e3563

The following sprites are modified / based on Oryx Design Lab sprites, their modifications are the property of Google LLC:
- public/favicon.png
- public/assets/player-1.png
- public/assets/player-2.png

All other sprites are the property of Google LLC.

Full license details of the sprite pack: https://www.oryxdesignlab.com/license

