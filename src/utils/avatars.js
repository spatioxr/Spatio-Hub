export const AVATAR_BUCKET = 'employee-avatars';
export const AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60;
const avatarMigrations = new Map();

export const isEmbeddedAvatar = (value) => (
  typeof value === 'string' && value.startsWith('data:image/')
);

export const cacheableAvatarUrl = (value) => (
  typeof value === 'string' && /^https:\/\//i.test(value) ? value : null
);

export const avatarPathForEmployee = (employeeId, version = Date.now()) => (
  `${employeeId}/avatar-${version}.jpg`
);

export const dataUrlToBlob = (dataUrl) => {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!match) throw new Error('The saved profile picture is not a supported image.');

  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
};

export const canvasToJpegBlob = (canvas, quality = 0.75) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Unable to prepare the profile picture.'));
  }, 'image/jpeg', quality);
});

export const createSignedAvatarUrl = async (client, path) => {
  if (!path) return null;

  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, AVATAR_SIGNED_URL_TTL_SECONDS);

  if (error) throw error;
  return data?.signedUrl || null;
};

export const createSignedAvatarUrls = async (client, paths) => {
  const uniquePaths = [...new Set((paths || []).filter(Boolean))];
  if (!uniquePaths.length) return {};

  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(uniquePaths, AVATAR_SIGNED_URL_TTL_SECONDS);

  if (error) throw error;

  return Object.fromEntries(
    (data || [])
      .filter((entry) => entry.path && entry.signedUrl && !entry.error)
      .map((entry) => [entry.path, entry.signedUrl]),
  );
};

export const storeEmployeeAvatar = async ({
  client,
  employeeId,
  image,
  previousPath = null,
  version = Date.now(),
}) => {
  const path = avatarPathForEmployee(employeeId, version);
  const { error: uploadError } = await client.storage
    .from(AVATAR_BUCKET)
    .upload(path, image, {
      cacheControl: String(AVATAR_SIGNED_URL_TTL_SECONDS),
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: savedProfile, error: profileError } = await client
    .from('employees')
    .update({ avatar_path: path, avatar_url: null })
    .eq('id', employeeId)
    .select('avatar_path')
    .maybeSingle();

  if (profileError || savedProfile?.avatar_path !== path) {
    await client.storage.from(AVATAR_BUCKET).remove([path]);
    throw profileError || new Error('The profile picture could not be linked to your profile.');
  }

  let signedUrl = null;
  try {
    signedUrl = await createSignedAvatarUrl(client, path);
  } catch (error) {
    console.warn('The profile picture was saved but its preview could not be loaded.');
  }

  if (previousPath && previousPath !== path) {
    const { error: cleanupError } = await client.storage
      .from(AVATAR_BUCKET)
      .remove([previousPath]);
    if (cleanupError) console.warn('Unable to remove the previous profile picture.');
  }

  return { path, signedUrl };
};

export const migrateEmbeddedEmployeeAvatar = async ({
  client,
  employeeId,
  embeddedAvatar,
  version = Date.now(),
}) => {
  if (!isEmbeddedAvatar(embeddedAvatar)) return null;
  const migrationKey = `${employeeId}:${embeddedAvatar.length}`;
  if (avatarMigrations.has(migrationKey)) return avatarMigrations.get(migrationKey);

  const migration = storeEmployeeAvatar({
    client,
    employeeId,
    image: dataUrlToBlob(embeddedAvatar),
    version,
  });

  avatarMigrations.set(migrationKey, migration);
  try {
    return await migration;
  } finally {
    avatarMigrations.delete(migrationKey);
  }
};
