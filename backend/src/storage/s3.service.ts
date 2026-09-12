import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import fs from "fs";
import path from "path";

export interface UploadResult {
  s3Key: string;
  bucket: string;
  sizeBytes: number;
  contentType: string;
}

export class StorageService {
  private static s3Client =
    env.STORAGE_PROVIDER === "s3"
      ? new S3Client({
          region: env.AWS_REGION,
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID || "",
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY || ""
          }
        })
      : null;

  // Local storage cache for mock mode
  private static mockStorageDir = path.resolve("./.local_storage");

  private static initMockStorage() {
    if (!fs.existsSync(this.mockStorageDir)) {
      fs.mkdirSync(this.mockStorageDir, { recursive: true });
    }
  }

  static async uploadFile(
    tenantId: string,
    folder: "pos" | "invoices" | "contracts",
    entityId: string,
    fileName: string,
    buffer: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    const s3Key = `tenants/${tenantId}/${folder}/${entityId}/${fileName}`;

    if (env.STORAGE_PROVIDER === "s3" && this.s3Client) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: env.AWS_S3_BUCKET_NAME,
          Key: s3Key,
          Body: buffer,
          ContentType: contentType
        })
      );
      return {
        s3Key,
        bucket: env.AWS_S3_BUCKET_NAME,
        sizeBytes: buffer.length,
        contentType
      };
    } else {
      // Mock storage provider: save to local disk
      this.initMockStorage();
      const localFilePath = path.join(this.mockStorageDir, s3Key.replace(/\//g, "_"));
      fs.writeFileSync(localFilePath, buffer);
      logger.info({ s3Key, size: buffer.length }, "Uploaded file to mock storage");
      return {
        s3Key,
        bucket: "mock-bucket",
        sizeBytes: buffer.length,
        contentType
      };
    }
  }

  static async getPresignedDownloadUrl(
    s3Key: string,
    expiresInSeconds = 300,
    baseUrl?: string,
    token?: string
  ): Promise<{ url: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    if (env.STORAGE_PROVIDER === "s3" && this.s3Client) {
      const command = new GetObjectCommand({
        Bucket: env.AWS_S3_BUCKET_NAME,
        Key: s3Key
      });
      const url = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
      return { url, expiresAt };
    } else {
      // Use the active server host/protocol (or fallback to port)
      const base = baseUrl || `http://localhost:${env.PORT}`;
      let url = `${base}${env.API_PREFIX}/storage/download?key=${encodeURIComponent(s3Key)}`;
      if (token) {
        url += `&token=${encodeURIComponent(token)}`;
      }
      return { url, expiresAt };
    }
  }

  static async getFileBuffer(s3Key: string): Promise<Buffer | null> {
    if (env.STORAGE_PROVIDER === "s3" && this.s3Client) {
      try {
        const command = new GetObjectCommand({
          Bucket: env.AWS_S3_BUCKET_NAME,
          Key: s3Key
        });
        const response = await this.s3Client.send(command);
        const byteArray = await response.Body?.transformToByteArray();
        return byteArray ? Buffer.from(byteArray) : null;
      } catch (err: any) {
        logger.warn({ err: err.message, s3Key }, "File not found or inaccessible in S3, returning null");
        return null;
      }
    } else {
      this.initMockStorage();
      const localFilePath = path.join(this.mockStorageDir, s3Key.replace(/\//g, "_"));
      if (fs.existsSync(localFilePath)) {
        return fs.readFileSync(localFilePath);
      }
      return null;
    }
  }
}
