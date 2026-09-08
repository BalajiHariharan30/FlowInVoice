import { Router, Request, Response } from "express";
import { authenticate } from "../../auth/auth.middleware.js";
import { UserRepository } from "../../repositories/index.js";

export const userRouter = Router();

userRouter.use(authenticate);

/**
 * GET /users
 * Read-only user list for v1 per §C11.5
 */
userRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user!.tenantId;
  const { page, pageSize } = req.query;

  const result = await UserRepository.findMany(tenantId, {
    page: page ? parseInt(page as string, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize as string, 10) : 20
  });

  const formattedData = result.data.map((u) => ({
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt
  }));

  res.status(200).json({
    data: formattedData,
    pagination: result.pagination
  });
});
