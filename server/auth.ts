import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { insertUserSchema } from "@shared/schema";

const PgStore = connectPgSimple(session);

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
  }
}

export function setupAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET || "autotrade-jp-dev-secret";
  const isProduction = process.env.NODE_ENV === "production";

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new PgStore({
        pool,
        createTableIfMissing: true,
        tableName: "session",
      }),
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
      },
    })
  );

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "ユーザー名とパスワードを入力してください" });
      }

      const { username, password } = parsed.data;

      if (username.length < 2) {
        return res.status(400).json({ message: "ユーザー名は2文字以上にしてください" });
      }
      if (password.length < 4) {
        return res.status(400).json({ message: "パスワードは4文字以上にしてください" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "このユーザー名は既に使用されています" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword });

      const initialCreditsStr = await storage.getSetting("initial_credits");
      const initialCredits = parseInt(initialCreditsStr || "0", 10);
      if (initialCredits > 0) {
        await storage.addCredits(user.id, initialCredits, `新規登録ボーナス（${initialCredits}クレジット）`);
      }

      req.session.userId = user.id;
      req.session.username = user.username;

      return res.status(201).json({ id: user.id, username: user.username });
    } catch (err: any) {
      console.error("[Auth] Registration error:", err);
      return res.status(500).json({ message: "登録に失敗しました" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "ユーザー名とパスワードを入力してください" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "ユーザー名またはパスワードが正しくありません" });
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "ユーザー名またはパスワードが正しくありません" });
      }

      req.session.userId = user.id;
      req.session.username = user.username;

      return res.json({ id: user.id, username: user.username });
    } catch (err: any) {
      console.error("[Auth] Login error:", err);
      return res.status(500).json({ message: "ログインに失敗しました" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "ログアウトに失敗しました" });
      }
      res.clearCookie("connect.sid");
      return res.json({ message: "ログアウトしました" });
    });
  });

  app.get("/api/auth/user", (req: Request, res: Response) => {
    if (req.session.userId) {
      return res.json({ id: req.session.userId, username: req.session.username });
    }
    return res.status(401).json({ message: "未認証" });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.userId) {
    (req as any).user = { id: req.session.userId, username: req.session.username };
    return next();
  }
  return res.status(401).json({ message: "ログインが必要です" });
}
