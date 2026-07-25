// Server entrypoint: callers must never serialize resolved credentials to clients.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

interface EncryptedCredential {
  encryptedValue: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  keyLastFour: string;
}

function masterKey(): Buffer {
  const configured = process.env.DATA_LAB_CREDENTIAL_MASTER_KEY?.trim();
  if (!configured) {
    throw new Error('未配置 DATA_LAB_CREDENTIAL_MASTER_KEY，不能保存数据库加密凭据');
  }
  return createHash('sha256').update(configured).digest();
}

export function encryptProviderCredential(value: string): EncryptedCredential {
  const secret = value.trim();
  if (secret.length < 8) throw new Error('访问密钥长度不足');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    encryptedValue: encrypted.toString('base64'),
    encryptionIv: iv.toString('base64'),
    encryptionAuthTag: cipher.getAuthTag().toString('base64'),
    keyLastFour: secret.slice(-4),
  };
}

export function decryptProviderCredential(input: {
  encryptedValue: string;
  encryptionIv: string;
  encryptionAuthTag: string;
}): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    masterKey(),
    Buffer.from(input.encryptionIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(input.encryptionAuthTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(input.encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function resolveProviderCredential(input: {
  sourceType: string;
  envVarName: string;
  encryptedValue: string;
  encryptionIv: string;
  encryptionAuthTag: string;
}): string {
  if (input.sourceType === 'ENV') {
    const envVarName = input.envVarName.trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(envVarName)) throw new Error('凭据环境变量名称不合法');
    const value = process.env[envVarName]?.trim();
    if (!value) throw new Error(`环境变量 ${envVarName} 未配置或为空`);
    return value;
  }
  if (input.sourceType === 'ENCRYPTED_DB') return decryptProviderCredential(input);
  throw new Error('未知的凭据来源');
}

export function credentialLastFourForEnv(envVarName: string): string {
  const value = process.env[envVarName]?.trim();
  return value ? value.slice(-4) : '';
}
