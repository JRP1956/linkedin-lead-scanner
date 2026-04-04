const { getDb } = require('./queries');

// ─── ICP Profile CRUD ───────────────────────────────────────────────────────

function createICPProfile({ name, config }) {
  const configJson = typeof config === 'string' ? config : JSON.stringify(config);
  const stmt = getDb().prepare(`
    INSERT INTO icp_profiles (name, config_json)
    VALUES (?, ?)
  `);
  const result = stmt.run(name, configJson);
  return getICPProfileById(result.lastInsertRowid);
}

function getICPProfileById(id) {
  const profile = getDb().prepare('SELECT * FROM icp_profiles WHERE id = ?').get(id);
  if (profile) {
    try {
      profile.config = JSON.parse(profile.config_json);
    } catch {
      profile.config = {};
    }
  }
  return profile;
}

function getICPProfileByName(name) {
  const profile = getDb().prepare('SELECT * FROM icp_profiles WHERE name = ?').get(name);
  if (profile) {
    try {
      profile.config = JSON.parse(profile.config_json);
    } catch {
      profile.config = {};
    }
  }
  return profile;
}

function getAllICPProfiles() {
  const profiles = getDb().prepare('SELECT * FROM icp_profiles ORDER BY created_at DESC').all();
  return profiles.map(p => {
    try {
      p.config = JSON.parse(p.config_json);
    } catch {
      p.config = {};
    }
    return p;
  });
}

function updateICPProfile(id, { name, config }) {
  const fields = [];
  const values = [];

  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (config !== undefined) {
    fields.push('config_json = ?');
    values.push(typeof config === 'string' ? config : JSON.stringify(config));
  }

  if (fields.length === 0) return getICPProfileById(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb().prepare(`UPDATE icp_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getICPProfileById(id);
}

function deleteICPProfile(id) {
  return getDb().prepare('DELETE FROM icp_profiles WHERE id = ?').run(id);
}

module.exports = {
  createICPProfile,
  getICPProfileById,
  getICPProfileByName,
  getAllICPProfiles,
  updateICPProfile,
  deleteICPProfile,
};
