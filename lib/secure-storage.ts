import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { log } from './logger';

// NOTE: SecureStore is not accessible when the device screen is locked or during certain
// app lifecycle states (background, WebRTC event handlers, etc.). To work around this,
// we cache all SecureStore values in memory during app initialization (when the app is
// in the foreground and SecureStore is accessible). All getter functions use the cache
// first, falling back to SecureStore only if the cache is empty.

const OPENAI_API_KEY = 'VIBEFLUENT_OPENAI_API_KEY';
const GITHUB_TOKEN_KEY = 'VIBEMACHINE_GITHUB_TOKEN';

// Google Drive Keys
const GDRIVE_CLIENT_ID_OVERRIDE_KEY = 'VIBEMACHINE_GDRIVE_CLIENT_ID_OVERRIDE';
const GDRIVE_ACCESS_TOKEN_KEY = 'VIBEMACHINE_GDRIVE_ACCESS_TOKEN';
const GDRIVE_REFRESH_TOKEN_KEY = 'VIBEMACHINE_GDRIVE_REFRESH_TOKEN';

// Pydantic Logfire Keys
const LOGFIRE_API_KEY = 'VIBEMACHINE_LOGFIRE_API_KEY';
const LOGFIRE_ENABLED_KEY = 'VIBEMACHINE_LOGFIRE_ENABLED';

// In-memory cache for all SecureStore values
// This cache is populated during app initialization and updated on every write operation
const cache: Map<string, string | null> = new Map();

// Track whether cache has been initialized
let cacheInitialized = false;

/**
 * Initialize the cache by loading all values from SecureStore.
 * This should be called during app initialization when the app is in the foreground
 * and SecureStore is guaranteed to be accessible.
 */
export async function initializeSecureStorageCache(): Promise<void> {
  log.info('🔄 Initializing SecureStore cache...', {});

  const keys = [
    OPENAI_API_KEY,
    GITHUB_TOKEN_KEY,
    GDRIVE_CLIENT_ID_OVERRIDE_KEY,
    GDRIVE_ACCESS_TOKEN_KEY,
    GDRIVE_REFRESH_TOKEN_KEY,
    LOGFIRE_API_KEY,
  ];

  try {
    // Load all values from SecureStore in parallel
    const results = await Promise.allSettled(
      keys.map(async (key) => {
        try {
          const value = await SecureStore.getItemAsync(key);
          cache.set(key, value);
          return { key, success: true, hasValue: value !== null };
        } catch (error) {
          log.warn(`⚠️ Failed to load ${key} during cache initialization`, {}, error);
          cache.set(key, null);
          return { key, success: false, hasValue: false };
        }
      })
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const valueCount = results.filter(
      (r) => r.status === 'fulfilled' && r.value.hasValue
    ).length;

    cacheInitialized = true;
    log.info('✅ SecureStore cache initialized', {}, {
      totalKeys: keys.length,
      successfulLoads: successCount,
      valuesFound: valueCount,
    });
  } catch (error) {
    log.error('❌ Failed to initialize SecureStore cache', {}, error);
    cacheInitialized = true; // Mark as initialized even on error to prevent blocking
  }
}

/**
 * Get a value from the cache. If cache is not initialized or value is not in cache,
 * attempts to read from SecureStore directly.
 *
 * @param key - The SecureStore key to retrieve
 * @returns The cached value, or null if not found
 */
async function getCachedValue(key: string): Promise<string | null> {
  // If cache has this key, return it immediately (even if null)
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  // Cache miss - try to load from SecureStore
  try {
    const value = await SecureStore.getItemAsync(key);
    cache.set(key, value);
    return value;
  } catch (error) {
    // SecureStore access failed (likely due to screen lock or background state)
    // Return null and log the issue
    log.warn(`⚠️ SecureStore access failed for ${key}, returning null`, {}, error);
    cache.set(key, null);
    return null;
  }
}

/**
 * Update a value in both SecureStore and the cache.
 *
 * @param key - The SecureStore key to update
 * @param value - The value to store
 */
async function setCachedValue(key: string, value: string): Promise<void> {
  // Update SecureStore first
  await SecureStore.setItemAsync(key, value);
  // Then update cache
  cache.set(key, value);
}

/**
 * Delete a value from both SecureStore and the cache.
 *
 * @param key - The SecureStore key to delete
 */
async function deleteCachedValue(key: string): Promise<void> {
  // Delete from SecureStore first
  await SecureStore.deleteItemAsync(key);
  // Then update cache to null
  cache.set(key, null);
}

// OpenAI API Key Functions

export async function saveApiKey(apiKey: string): Promise<void> {
  if (!apiKey || apiKey.length === 0) {
    throw new Error('API key must not be empty.');
  }

  log.info('🔄 Attempting to save API key...', {});

  try {
    await setCachedValue(OPENAI_API_KEY, apiKey);
    log.info('✅ API key saved to SecureStore and cache successfully', {});

    const verification = await getCachedValue(OPENAI_API_KEY);
    if (verification) {
      log.info('✅ SecureStore verification successful', {});
    } else {
      log.error('❌ SecureStore verification failed', {});
    }
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.error('❌ SecureStore failed to save API key', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function getApiKey(_: { forceSecureStore?: boolean } = {}): Promise<string | null> {
  log.info('🔄 Attempting to retrieve OpenAI API key...', {});

  try {
    const apiKey = await getCachedValue(OPENAI_API_KEY);

    if (apiKey) {
      log.info('✅ OpenAI API key retrieved from cache', {});
      return apiKey;
    }

    log.info('ℹ️ No OpenAI API key found in cache', {});
    return null;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to retrieve API key', {}, errorDetails);
    return null;
  }
}

export async function deleteApiKey(): Promise<void> {
  log.info('🔄 Attempting to delete API key from SecureStore...', {});

  try {
    await deleteCachedValue(OPENAI_API_KEY);
    log.info('✅ API key deleted from SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.warn('⚠️ Failed to delete from SecureStore (may not exist)', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function hasApiKey(): Promise<boolean> {
  try {
    const apiKey = await getApiKey({ forceSecureStore: true });
    return apiKey !== null && apiKey.length > 0;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to check API key existence', {}, errorDetails);
    return false;
  }
}

export function isValidApiKey(apiKey: string): boolean {
  return !!apiKey && apiKey.startsWith('sk-') && apiKey.length > 20;
}

// GitHub Token Functions

export async function saveGithubToken(token: string): Promise<void> {
  if (!token || token.length === 0) {
    throw new Error('GitHub token must not be empty.');
  }

  log.info('🔄 Attempting to save GitHub token...', {});

  try {
    await setCachedValue(GITHUB_TOKEN_KEY, token);
    log.info('✅ GitHub token saved to SecureStore and cache successfully', {});

    const verification = await getCachedValue(GITHUB_TOKEN_KEY);
    if (verification) {
      log.info('✅ SecureStore verification successful', {});
    } else {
      log.error('❌ SecureStore verification failed', {});
    }
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.error('❌ SecureStore failed to save GitHub token', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function getGithubToken(): Promise<string | null> {
  log.info('🔄 Attempting to retrieve GitHub token...', {});

  try {
    const token = await getCachedValue(GITHUB_TOKEN_KEY);

    if (token) {
      log.info('✅ GitHub token retrieved from cache', {});
      return token;
    }

    log.info('ℹ️ No GitHub token found in cache', {});
    return null;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to retrieve GitHub token', {}, errorDetails);
    return null;
  }
}

export async function deleteGithubToken(): Promise<void> {
  log.info('🔄 Attempting to delete GitHub token from SecureStore...', {});

  try {
    await deleteCachedValue(GITHUB_TOKEN_KEY);
    log.info('✅ GitHub token deleted from SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.warn('⚠️ Failed to delete from SecureStore (may not exist)', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function hasGithubToken(): Promise<boolean> {
  try {
    const token = await getGithubToken();
    return token !== null && token.length > 0;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to check GitHub token existence', {}, errorDetails);
    return false;
  }
}

export function isValidGithubToken(token: string): boolean {
  return !!token && (token.startsWith('ghp_') || token.startsWith('github_pat_')) && token.length > 20;
}

// Google Drive Client ID Functions

export async function saveGDriveClientIdOverride(clientId: string): Promise<void> {
  if (!clientId || clientId.length === 0) {
    throw new Error('GDrive Client ID override must not be empty.');
  }

  log.info('🔄 Saving GDrive Client ID override...', {});
  try {
    await setCachedValue(GDRIVE_CLIENT_ID_OVERRIDE_KEY, clientId);
    log.info('✅ GDrive Client ID override saved to SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.error('❌ SecureStore failed to save GDrive Client ID override', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function deleteGDriveClientIdOverride(): Promise<void> {
  log.info('🔄 Deleting GDrive Client ID override...', {});
  try {
    await deleteCachedValue(GDRIVE_CLIENT_ID_OVERRIDE_KEY);
    log.info('✅ GDrive Client ID override deleted from SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.warn('⚠️ Failed to delete from SecureStore (may not exist)', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function getGDriveClientIdOverride(): Promise<string | null> {
  try {
    const v = await getCachedValue(GDRIVE_CLIENT_ID_OVERRIDE_KEY);
    if (v) return v;
    log.info('ℹ️ No GDrive Client ID override found in cache', {});
    return null;
  } catch (err) {
    const errorDetails = {
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    };
    log.error('❌ Failed to read GDrive Client ID override', {}, errorDetails);
    return null;
  }
}

// Returns override if present; otherwise falls back to EXPO_PUBLIC_GOOGLE_API_CLIENT_ID (or null)
export async function getGDriveClientId(): Promise<string | null> {
  const override = await getGDriveClientIdOverride();
  if (override && override.length > 0) {
    log.info('✅ Using GDrive Client ID override from storage', {});
    return override;
  }
  const envDefault = process.env.EXPO_PUBLIC_GOOGLE_API_CLIENT_ID || null;
  if (envDefault) {
    log.info('ℹ️ Using GDrive Client ID from .env (EXPO_PUBLIC_GOOGLE_API_CLIENT_ID)', {});
  } else {
    log.warn('ℹ️ No GDrive Client ID override or .env default found', {});
  }
  return envDefault;
}

// Google Drive Token Functions

export async function saveGDriveAccessToken(token: string): Promise<void> {
  if (!token || token.length === 0) {
    throw new Error('GDrive access token must not be empty.');
  }

  log.info('🔄 Saving GDrive access token...', {});
  try {
    await setCachedValue(GDRIVE_ACCESS_TOKEN_KEY, token);
    log.info('✅ GDrive access token saved to SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.error('❌ SecureStore failed to save GDrive access token', {}, errorDetails);
    throw secureStoreError;
  }
}

// Wrapper to match callers (expiresIn currently unused)
export async function setGDriveAccessToken(token: string, _expiresIn?: number): Promise<void> {
  return saveGDriveAccessToken(token);
}

export async function saveGDriveRefreshToken(token: string): Promise<void> {
  if (!token || token.length === 0) {
    throw new Error('GDrive refresh token must not be empty.');
  }

  log.info('🔄 Saving GDrive refresh token...', {});
  try {
    await setCachedValue(GDRIVE_REFRESH_TOKEN_KEY, token);
    log.info('✅ GDrive refresh token saved to SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.error('❌ SecureStore failed to save GDrive refresh token', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function getGDriveAccessToken(): Promise<string | null> {
  try {
    const v = await getCachedValue(GDRIVE_ACCESS_TOKEN_KEY);
    if (v) return v;
    log.info('ℹ️ No GDrive access token found in cache', {});
    return null;
  } catch (err) {
    const errorDetails = {
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    };
    log.error('❌ Failed to read GDrive access token', {}, errorDetails);
    return null;
  }
}

export async function getGDriveRefreshToken(): Promise<string | null> {
  try {
    const v = await getCachedValue(GDRIVE_REFRESH_TOKEN_KEY);
    if (v) return v;
    log.info('ℹ️ No GDrive refresh token found in cache', {});
    return null;
  } catch (err) {
    const errorDetails = {
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    };
    log.error('❌ Failed to read GDrive refresh token', {}, errorDetails);
    return null;
  }
}

export async function deleteGDriveAccessToken(): Promise<void> {
  try {
    await deleteCachedValue(GDRIVE_ACCESS_TOKEN_KEY);
    log.info('✅ GDrive access token deleted from SecureStore and cache', {});
  } catch (err) {
    const errorDetails = {
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    };
    log.warn('⚠️ Failed to delete GDrive access token from SecureStore (may not exist)', {}, errorDetails);
  }
}

export async function deleteGDriveRefreshToken(): Promise<void> {
  try {
    await deleteCachedValue(GDRIVE_REFRESH_TOKEN_KEY);
    log.info('✅ GDrive refresh token deleted from SecureStore and cache', {});
  } catch (err) {
    const errorDetails = {
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    };
    log.warn('⚠️ Failed to delete GDrive refresh token from SecureStore (may not exist)', {}, errorDetails);
  }
}

export async function hasGDriveTokens(): Promise<boolean> {
  const [a, r] = await Promise.all([getGDriveAccessToken(), getGDriveRefreshToken()]);
  return Boolean(a || r);
}

export async function deleteGDriveTokens(): Promise<void> {
  await Promise.all([deleteGDriveAccessToken(), deleteGDriveRefreshToken()]);
}

// Pydantic Logfire API Key Functions

export async function saveLogfireApiKey(apiKey: string): Promise<void> {
  if (!apiKey || apiKey.length === 0) {
    throw new Error('Logfire API key must not be empty.');
  }

  log.info('🔄 Attempting to save Logfire API key...', {});

  try {
    await setCachedValue(LOGFIRE_API_KEY, apiKey);
    log.info('✅ Logfire API key saved to SecureStore and cache successfully', {});

    const verification = await getCachedValue(LOGFIRE_API_KEY);
    if (verification) {
      log.info('✅ SecureStore verification successful', {});
    } else {
      log.error('❌ SecureStore verification failed', {});
    }
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.error('❌ SecureStore failed to save Logfire API key', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function getLogfireApiKey(): Promise<string | null> {
  log.info('🔄 Attempting to retrieve Logfire API key...', {});

  try {
    const apiKey = await getCachedValue(LOGFIRE_API_KEY);

    if (apiKey) {
      log.info('✅ Logfire API key retrieved from cache', {});
      return apiKey;
    }

    log.info('ℹ️ No Logfire API key found in cache', {});
    return null;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to retrieve Logfire API key', {}, errorDetails);
    return null;
  }
}

export async function deleteLogfireApiKey(): Promise<void> {
  log.info('🔄 Attempting to delete Logfire API key from SecureStore...', {});

  try {
    await deleteCachedValue(LOGFIRE_API_KEY);
    log.info('✅ Logfire API key deleted from SecureStore and cache', {});
  } catch (secureStoreError) {
    const errorDetails = {
      name: (secureStoreError as Error).name,
      message: (secureStoreError as Error).message,
      stack: (secureStoreError as Error).stack,
    };
    log.warn('⚠️ Failed to delete from SecureStore (may not exist)', {}, errorDetails);
    throw secureStoreError;
  }
}

export async function hasLogfireApiKey(): Promise<boolean> {
  try {
    const apiKey = await getLogfireApiKey();
    return apiKey !== null && apiKey.length > 0;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to check Logfire API key existence', {}, errorDetails);
    return false;
  }
}

// Pydantic Logfire Enabled State Functions
// Note: These use AsyncStorage, not SecureStore, so no caching is needed

export async function saveLogfireEnabled(enabled: boolean): Promise<void> {
  log.info('🔄 Attempting to save Logfire enabled state:', {}, enabled);

  try {
    await AsyncStorage.setItem(LOGFIRE_ENABLED_KEY, JSON.stringify(enabled));
    log.info('✅ Logfire enabled state saved to AsyncStorage successfully', {});
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to save Logfire enabled state', {}, errorDetails);
    throw error;
  }
}

export async function getLogfireEnabled(): Promise<boolean> {
  log.info('🔄 Attempting to retrieve Logfire enabled state...', {});

  try {
    const enabled = await AsyncStorage.getItem(LOGFIRE_ENABLED_KEY);
    if (enabled !== null) {
      const result = JSON.parse(enabled);
      log.info('✅ Logfire enabled state retrieved:', {}, result);
      return result;
    }

    log.info('ℹ️ No Logfire enabled state found, defaulting to false', {});
    return false;
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to retrieve Logfire enabled state', {}, errorDetails);
    return false;
  }
}

// Clear All Stored Secrets

export async function clearAllStoredSecrets(): Promise<void> {
  log.info('🔄 Starting clear all stored secrets operation...', {});

  // Define all SecureStore keys that need to be deleted
  const secureStoreKeys = [
    OPENAI_API_KEY,
    GITHUB_TOKEN_KEY,
    GDRIVE_CLIENT_ID_OVERRIDE_KEY,
    GDRIVE_ACCESS_TOKEN_KEY,
    GDRIVE_REFRESH_TOKEN_KEY,
    LOGFIRE_API_KEY,
  ];

  // Define all AsyncStorage keys that need to be deleted
  const asyncStorageKeys = [
    LOGFIRE_ENABLED_KEY,
  ];

  try {
    // Log all keys that will be deleted BEFORE deletion
    log.info('📋 About to delete the following SecureStore keys:', {}, {
      keys: secureStoreKeys,
      count: secureStoreKeys.length,
    });

    for (const key of secureStoreKeys) {
      log.info(`  ⚠️ About to delete SecureStore key: ${key}`, {});
    }

    log.info('📋 About to delete the following AsyncStorage keys:', {}, {
      keys: asyncStorageKeys,
      count: asyncStorageKeys.length,
    });

    for (const key of asyncStorageKeys) {
      log.info(`  ⚠️ About to delete AsyncStorage key: ${key}`, {});
    }

    // Now perform the batch deletion using deleteCachedValue to update cache
    log.info('🗑️ Deleting all SecureStore keys...', {});
    await Promise.all(
      secureStoreKeys.map((key) =>
        deleteCachedValue(key).catch((error) => {
          log.warn(`⚠️ Failed to delete SecureStore key: ${key}`, {}, {
            error: (error as Error).message,
          });
        })
      )
    );

    log.info('🗑️ Deleting all AsyncStorage keys...', {});
    await Promise.all(
      asyncStorageKeys.map((key) =>
        AsyncStorage.removeItem(key).catch((error) => {
          log.warn(`⚠️ Failed to delete AsyncStorage key: ${key}`, {}, {
            error: (error as Error).message,
          });
        })
      )
    );

    log.info('✅ All stored secrets cleared successfully', {}, {
      secureStoreKeysDeleted: secureStoreKeys.length,
      asyncStorageKeysDeleted: asyncStorageKeys.length,
      totalKeysDeleted: secureStoreKeys.length + asyncStorageKeys.length,
    });
  } catch (error) {
    const errorDetails = {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    };
    log.error('❌ Failed to clear all stored secrets', {}, errorDetails);
    throw error;
  }
}
