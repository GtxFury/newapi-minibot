import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class UserTokenStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.authMap = new Map();
  }

  async load() {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      const entries = Object.entries(parsed?.tokens || {});
      for (const [userId, item] of entries) {
        // 兼容旧版本：value 是 string（仅 token）
        if (typeof item === "string" && item.trim()) {
          this.authMap.set(String(userId), { token: item.trim(), userId: null });
          continue;
        }

        if (item && typeof item === "object" && typeof item.token === "string" && item.token.trim()) {
          const mappedUserId =
            item.userId === undefined || item.userId === null || item.userId === ""
              ? null
              : Number(item.userId);
          this.authMap.set(String(userId), {
            token: item.token.trim(),
            userId: Number.isFinite(mappedUserId) ? mappedUserId : null
          });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  getAuth(userId) {
    return this.authMap.get(String(userId)) || null;
  }

  async setAuth(userId, auth) {
    this.authMap.set(String(userId), {
      token: String(auth?.token || "").trim(),
      userId:
        auth?.userId === undefined || auth?.userId === null || auth?.userId === ""
          ? null
          : Number(auth.userId)
    });
    await this.persist();
  }

  async clearAuth(userId) {
    this.authMap.delete(String(userId));
    await this.persist();
  }

  async persist() {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const payload = {
      updatedAt: new Date().toISOString(),
      tokens: Object.fromEntries(this.authMap.entries())
    };

    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}
