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

import { appConfig } from '../../app/app.config';

export interface PropertyValue
{
  type: string;
  value: any;
  order?: number;
  rootProperty?: boolean;
}

export interface ConfigObject
{
  [key: string]: PropertyValue;
}

export interface Behaviour
{
  id: string;
  type: string;
  inherit: string;
  config: ConfigObject;
}

export interface FrameObject
{
  id: string;
  type: string;
  inherit: string;
  config: ConfigObject;
}

export interface AnimationObject
{
  id: string;
  type: string;
  inherit: string;
  config: ConfigObject;
  frames: FrameObject[];
}

export interface ClassDefinition
{
  id: string;
  type: string;
  inherit: string;
  config: ConfigObject;
  behaviours: Behaviour[];
  animations: AnimationObject[];
}

export interface Instance
{
  id: string;
  type: string;
  inherit: string;
  config: ConfigObject;
  behaviours: Behaviour[];
  animations: AnimationObject[]; // Added animations to Instance interface
}

export interface Layer
{
  id: string;
  type: string;
  inherit: string;
  config: ConfigObject;
  instances: Instance[];
}

export interface Layout
{
  id: string;
  type: string;
  config: ConfigObject;
  layers: Layer[];
}

export interface Texture
{
  id: string;
  type: string;
  config: ConfigObject;
}

export interface GameData
{
  game: {
    id?: string;
    type?: string;
    classes: ClassDefinition[];
    layouts: Layout[];
    behaviours: Behaviour[]; // Global behaviour definitions
    textures: Texture[];
    config: ConfigObject;
  };
}

export class WorldData
{
  private data: GameData | null = null;
  private classPropertiesCache: Map<string, any> = new Map();
  private behaviourPropertiesCache: Map<string, any> = new Map();
  private allClassBehavioursMap: Map<string, Behaviour> = new Map();
  private layoutCache: Map<string, Layout> = new Map();
  private layoutNameCache: Map<string, Layout> = new Map();
  private flipY: boolean = false;
  private objectIndex: Map<string, any> = new Map();

  private classMap: Map<string, ClassDefinition> = new Map();
  private globalBehaviourMap: Map<string, Behaviour> = new Map();

  getData(): GameData | null
  {
    return this.data;
  }

  isFlipY(): boolean
  {
    return this.flipY;
  }

  loadWorldData(data: GameData, flipY: boolean = true)
  {
    // Deep clone to avoid mutating the global cache
    this.data = JSON.parse(JSON.stringify(data));
    this.classPropertiesCache.clear();
    this.behaviourPropertiesCache.clear();
    this.allClassBehavioursMap.clear();

    if (this.data && this.data.game && this.data.game.classes)
    {
      for (const cls of this.data.game.classes)
      {
        if (cls.behaviours)
        {
          for (const behaviour of cls.behaviours)
          {
            if (behaviour.id)
            {
              this.allClassBehavioursMap.set(behaviour.id, behaviour);
            }
          }
        }
      }
    }

    this.classMap.clear();
    if (this.data?.game?.classes)
    {
      this.data.game.classes.forEach(c => this.classMap.set(c.id, c));
    }

    this.globalBehaviourMap.clear();
    if (this.data?.game?.behaviours)
    {
      this.data.game.behaviours.forEach(b => this.globalBehaviourMap.set(b.id, b));
    }

    this.injectDrawEasel();

    this.layoutCache.clear();
    this.layoutNameCache.clear();

    if (this.data && this.data.game && this.data.game.layouts)
    {
      this.data.game.layouts.forEach(layout =>
      {
        this.layoutCache.set(layout.id, layout);
        const name = this.unwrapConfig(layout.config).name?.toLowerCase();
        if (name)
        {
          this.layoutNameCache.set(name, layout);
        }
      });
    }

    this.flipY = flipY;
    if (flipY) this.normalizeCoordinates();
    console.log('World Data Loaded', this.data);
    this.indexObjects();
  }

  private injectDrawEasel()
  {
    if (!this.data) return;
    const startLayoutId = appConfig.overrideStartLayoutId || this.data.game.config['startLayout']?.value;
    if (!startLayoutId) return;

    const startLayout = this.data.game.layouts.find(l => l.id === startLayoutId);
    if (!startLayout) return;

    // Find the actors layer
    const actorsLayer = startLayout.layers.find(l => {
      const nameProp = l.config && l.config['name'];
      return nameProp && nameProp.value === 'actors';
    });

    if (actorsLayer) {
      console.log('Injecting Draw Easel into actors layer of starting layout');
      const easelInstance: Instance = {
        id: 'dynamic_draw_easel',
        type: 'instance',
        inherit: '00000193850245546978', // Computer class
        config: {
          x: { type: 'integer', value: '592' },
          y: { type: 'integer', value: '176' },
          name: { type: 'string', value: 'Easel' }
        },
        behaviours: [
          {
            id: 'easel_draw_override',
            type: 'behaviour',
            inherit: '00000736888165856790', // Class Behaviour ID for InteractiveBehaviour
            config: {
              type: { type: 'string', value: 'draw' },
              chatResponse: { type: 'string', value: 'Draw a happy yellow sun! ☀️' },
              linkURL: { type: 'string', value: 'BlueDoor' }
            }
          }
        ],
        animations: []
      };
      actorsLayer.instances.push(easelInstance);
    }
  }

  private indexObjects()
  {
    if (!this.data) return;
    this.objectIndex.clear();
    this.data.game.layouts.forEach(layout =>
    {
      this.indexObject(layout);
      layout.layers.forEach(layer =>
      {
        this.indexObject(layer);
        layer.instances.forEach(inst =>
        {
          this.indexObject(inst);
        });
      });
    });

    this.data.game.classes.forEach(cls =>
    {
      this.indexObject(cls);
      cls.animations.forEach(anim =>
      {
        this.indexObject(anim);
        anim.frames.forEach(frame =>
        {
          this.indexObject(frame);
        });
      });

      cls.behaviours.forEach(b =>
      {
        this.indexObject(b);
      });
    });

    this.data.game.behaviours.forEach(b =>
    {
      this.indexObject(b);
    });

    this.data.game.textures.forEach(t =>
    {
      this.indexObject(t);
    });
  }

  private normalizeCoordinates()
  {
    if (!this.data) return;
    this.data.game.layouts.forEach(layout =>
    {
      const config = this.unwrapConfig(layout.config);
      const height = config.height || 1024;

      layout.layers.forEach(layer =>
      {
        layer.instances.forEach(inst =>
        {
          if (inst.config && inst.config['y'])
          {
            let yVal = parseFloat(inst.config['y'].value);
            if (isNaN(yVal)) yVal = 0;
            inst.config['y'].value = height - yVal;
          }
        });
      });
    });
  }

  getStartLayout(): Layout | undefined
  {
    if (!this.data) return undefined;
    const startLayoutId = appConfig.overrideStartLayoutId || this.data.game.config['startLayout']?.value;
    return this.getLayout(startLayoutId);
  }

  getLayout(id: string): Layout | undefined
  {
    return this.layoutCache.get(id);
  }

  getLayoutByName(name: string): Layout | undefined
  {
    return this.layoutNameCache.get(name.toLowerCase());
  }

  getClass(id: string): ClassDefinition | undefined
  {
    return this.classMap.get(id);
  }

  getGlobalBehaviour(id: string): Behaviour | undefined
  {
    return this.globalBehaviourMap.get(id);
  }

  getTextureList(): Texture[] | undefined
  {
    return this.data?.game.textures;
  }

  getTextureFile(id: string): string | undefined
  {
    return this.data?.game.textures.find(t => t.id === id)?.config["md5"]?.value;
  }

  // Unwraps { key: { value: ... } } to { key: ... }
  unwrapConfig<T = any>(config: ConfigObject): T
  {
    const result: any = {};
    if (!config) return result;

    for (const key in config)
    {
      if (key === '--marker') continue;

      const prop = config[key];
      let val = prop.value;

      // Strict type conversion
      if (prop.type === 'integer')
      {
        val = parseInt(val, 10);
        if (isNaN(val)) val = 0; // Safe fallback
      } else if (prop.type === 'float')
      {
        val = parseFloat(val);
        if (isNaN(val)) val = 0.0;
      } else if (prop.type === 'boolean')
      {
        val = (val === '1' || val === 1 || val === 'true' || val === true);
      } else if (prop.type === 'json')
      {
        if (val)
        {
          try
          {
            val = JSON.parse(val);
          } catch (e)
          {
            console.error(`Failed to parse JSON property ${key}`, e);
            val = null;
          }
        }
      }
      result[key] = val;
    }
    return result as T;
  }

  // Returns list of class definitions from root to leaf (the classId itself)
  getClassHierarchy(classId: string): ClassDefinition[]
  {
    const classDef = this.getClass(classId);
    if (!classDef) return [];

    let hierarchy: ClassDefinition[] = [];

    if (classDef.inherit)
    {
      const parents = classDef.inherit.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('intrinsic:'));
      for (const parentId of parents)
      {
        hierarchy = [...hierarchy, ...this.getClassHierarchy(parentId)];
      }
    }
    hierarchy.push(classDef);
    return hierarchy;
  }

  resolveClassProperties(classId: string): any
  {
    if (this.classPropertiesCache.has(classId))
    {
      return this.classPropertiesCache.get(classId);
    }

    const classDef = this.getClass(classId);
    if (!classDef)
    {
      return {};
    }

    let parentProps = {};
    if (classDef.inherit)
    {
      const parents = classDef.inherit.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('intrinsic:'));
      for (const parentId of parents)
      {
        const pProps = this.resolveClassProperties(parentId);
        parentProps = { ...parentProps, ...pProps };
      }
    }

    const classProps = this.unwrapConfig(classDef.config);
    const resolved = { ...parentProps, ...classProps };

    this.classPropertiesCache.set(classId, resolved);
    return resolved;
  }

  resolveInstanceProperties(instance: Instance, layer?: Layer): any
  {
    const classProps = this.resolveClassProperties(instance.inherit);
    const instanceProps = this.unwrapConfig(instance.config);

    const resolved = { ...classProps, ...instanceProps, _classId: instance.inherit, _instanceId: instance.id };

    if (layer)
    {
      const layerProps = this.unwrapConfig(layer.config);
      if (layerProps.z !== undefined)
      {
        resolved.z = (parseFloat(resolved.z) || 0) + layerProps.z;
      }
    }

    return resolved;
  }

  // Resolves behaviors for a class, including inherited behaviors from parent classes
  resolveClassBehaviours(classId: string): Map<string, any>
  {
    const hierarchy = this.getClassHierarchy(classId);
    const behaviorMap = new Map<string, any>();

    for (const cls of hierarchy)
    {
      if (cls.behaviours)
      {
        for (const b of cls.behaviours)
        {
          const props = this.resolveBehaviourProperties(b);
          behaviorMap.set(b.id, props);
        }
      }
    }
    return behaviorMap;
  }

  resolveInstanceBehaviours(instance: Instance): any[]
  {
    // 1. Get resolved class behaviors (merged from hierarchy)
    const classBehaviorsMap = this.resolveClassBehaviours(instance.inherit);

    // 2. Clone them to allow instance overrides without affecting cache/others
    const behaviorsMap = new Map<string, any>();
    classBehaviorsMap.forEach((v, k) => behaviorsMap.set(k, { ...v }));

    // 3. Apply Instance Behaviours (Overrides or New)
    if (instance.behaviours)
    {
      instance.behaviours.forEach(b =>
      {
        // Check if this behavior overrides a class behavior
        // The instance behavior's 'inherit' field matches the ID of the Class Behaviour
        if (behaviorsMap.has(b.inherit))
        {
          const existingProps = behaviorsMap.get(b.inherit);
          const newProps = this.unwrapConfig(b.config);
          // Merge override props
          Object.assign(existingProps, newProps);
        } else
        {
          // It's a new behavior added specifically to this instance
          const props = this.resolveBehaviourProperties(b);
          // We use b.id if available, or generate one? 
          // The system likely doesn't query instance-specific behaviors by ID often,
          // but for consistency we can just push it.
          // But to avoid duplicates if ID is provided:
          if (b.id)
          {
            behaviorsMap.set(b.id, props);
          } else
          {
            // If no ID, effectively anonymous, but we can store with random key or just strictly push later.
            // For now, let's treat it as a separate entry.
            // We will convert map to array anyway.
            // To avoid map key collision, we use a unique prefix.
            behaviorsMap.set('__inst_behav_' + Math.random(), props);
          }
        }
      });
    }
    return Array.from(behaviorsMap.values());
  }

  // Resolves animations for a class, including inherited animations
  resolveClassAnimations(classId: string): Map<string, AnimationObject>
  {
    const hierarchy = this.getClassHierarchy(classId);
    const animationMap = new Map<string, AnimationObject>();

    for (const cls of hierarchy)
    {
      if (cls.animations)
      {
        for (const anim of cls.animations)
        {
          if (anim.inherit)
          {
            // Override animation by the child id
            animationMap.set(anim.inherit, anim);
          } else
          {
            animationMap.set(anim.id, anim);
          }
        }
      }
    }
    return animationMap;
  }

  resolveInstanceAnimations(instance: Instance): AnimationObject[]
  {
    // 1. Get resolved class animations
    const classAnimationsMap = this.resolveClassAnimations(instance.inherit);

    // 2. Clone map to allow instance overrides
    const animationsMap = new Map<string, AnimationObject>(classAnimationsMap);

    // 3. Apply Instance Animation overrides
    if (instance.animations)
    {
      for (const anim of instance.animations)
      {
        animationsMap.set(anim.id, anim);
      }
    }

    return Array.from(animationsMap.values());
  }

  resolveBehaviourProperties(b: Behaviour): any
  {
    if (this.behaviourPropertiesCache.has(b.id))
    {
      return this.behaviourPropertiesCache.get(b.id);
    }

    let parentProps = {}
    if (b.inherit)
    {
      const globalDef = this.getGlobalBehaviour(b.inherit);
      if (globalDef)
      {
        parentProps = this.unwrapConfig(globalDef.config);
      } else if (this.behaviourPropertiesCache.has(b.inherit))
      {
        parentProps = this.behaviourPropertiesCache.get(b.inherit);
      } else
      {
        // search all class behaviours
        if (this.data)
        {
          for (const cls of this.data.game.classes)
          {
            for (const behaviour of cls.behaviours)
            {
              if (behaviour.id == b.inherit)
              {
                parentProps = this.resolveBehaviourProperties(behaviour);
              }
            }
          }
        }
      }
    }

    const instProps = this.unwrapConfig(b.config);
    const resolved = { ...parentProps, ...instProps };
    this.behaviourPropertiesCache.set(b.id, resolved);
    return resolved;
  }

  getClassAnimations(classId: string): AnimationObject[]
  {
    const animationMap = this.resolveClassAnimations(classId);
    return Array.from(animationMap.values());
  }

  resolveAnimationProperties(animation: AnimationObject): any
  {
    return this.unwrapConfig(animation.config);
  }

  resolveFrameProperties(frame: FrameObject): any
  {
    return this.unwrapConfig(frame.config);
  }

  indexObject(obj: any): void
  {
    this.objectIndex.set(obj.id, obj);
  }

  getObjectById(id: string): any
  {
    if (!id) return null;
    return this.objectIndex.get(id);
  }

  getValueByKey(id: string, key: string): any
  {
    const obj = this.getObjectById(id);
    //console.log('getvaluebykey', id, key, obj);

    if (!obj) return null;
    const config = obj.config;

    if (config[key])
    {
      return config[key].value;
    } else
    {
      if (obj.inherit)
      {
        return this.getValueByKey(obj.inherit, key);
      }
    }

    return null;
  }
}