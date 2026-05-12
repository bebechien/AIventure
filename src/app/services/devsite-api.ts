export class DevsiteAPI {
  private static callbacks = new Map<string, Function>();
  private static initialized = false;

  private static init() {
    if (this.initialized) return;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && typeof data === 'object' && data.id) {
        const cb = this.callbacks.get(data.id);
        if (cb) {
          this.callbacks.delete(data.id);
          if (Array.isArray(data.arguments)) {
            cb(...data.arguments);
          } else if (Array.isArray(data.result)) {
            cb(...data.result);
          } else {
            cb(data.result);
          }
        }
      }
    });
    this.initialized = true;
  }

  private static generateId(): string {
    return 'devsite_' + Math.random().toString(36).substring(2, 15);
  }

  private static sendMessage(method: string, args: any[], callback: Function) {
    if ("framebox" in window) {
      (window as any).framebox(method, ...args, callback);
    } else {
      this.init();
      const id = this.generateId();
      this.callbacks.set(id, callback);
      window.parent.postMessage({
        method,
        arguments: args,
        id
      }, '*');
    }
  }

  static doesUserHaveADeveloperProfile(callback: (result: boolean) => void) {
    this.sendMessage("doesUserHaveADeveloperProfile", [], callback);
  }

  static isBadgeAwarded(type: string, badgeData: any, callback?: (updatedBadgeData: any) => void) {
    this.sendMessage(
      "getDeveloperProfileBadgeStatus",
      [badgeData.url],
      (
        url: string,
        title: string,
        description: string,
        imagePath: string,
        awarded: boolean
      ) => {
        badgeData.unlocked = awarded;
        badgeData.icon = this._cleanUrl(imagePath);
        badgeData.text = title;
        badgeData.loading = false;

        if (callback) callback(badgeData);
      }
    );
  }

  static awardBadge(type: string, badgeData: any, callback?: (success: boolean) => void) {
    this.sendMessage(
      "awardDeveloperProfileBadge",
      [badgeData.url],
      (result: any) => {
        if (result) {
          console.log(`Badge awarded for type ${type}`);
          badgeData.unlocked = true;
          if (callback) callback(true);
        } else {
          if (callback) callback(false);
        }
      }
    );
  }

  private static _cleanUrl(url: string): string {
    return url;
  }
}
