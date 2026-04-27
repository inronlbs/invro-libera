/**
 * Invron E-Library - Settings Panel Component
 */

import { useState, useEffect } from 'react';
import db, { type UserSettings } from '../../db';
import './SettingsPanel.css';

// ============================================================================
// COMPONENT
// ============================================================================

export default function SettingsPanel() {
  const [settings, setSettings] = useState<UserSettings>({
    id: 'settings',
    ttsRate: 1.0,
    theme: 'light',
    fontSize: 16
  });
  const [isSaving, setIsSaving] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      const stored = await db.settings.get('settings');
      if (stored) {
        setSettings(stored);
      }
    };
    loadSettings();
  }, []);

  // Save settings
  const saveSettings = async (updates: Partial<UserSettings>) => {
    setIsSaving(true);
    const newSettings = {
      ...settings,
      ...updates
    };
    setSettings(newSettings);
    await db.settings.put(newSettings);
    setTimeout(() => setIsSaving(false), 500);
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <p>Customize your reading experience</p>
      </div>

      <div className="settings-sections">
        {/* Text-to-Speech Settings */}
        <section className="settings-section">
          <h3>
            <span className="section-icon">🔊</span>
            Read Aloud (TTS)
          </h3>
          
          <div className="setting-item">
            <div className="setting-info">
              <label>Reading Speed</label>
              <span className="setting-value">{settings.ttsRate}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.ttsRate}
              onChange={(e) => saveSettings({ ttsRate: parseFloat(e.target.value) })}
              className="setting-slider"
            />
            <div className="slider-labels">
              <span>Slow</span>
              <span>Normal</span>
              <span>Fast</span>
            </div>
          </div>

          {settings.ttsVoice && (
            <div className="setting-item">
              <div className="setting-info">
                <label>Selected Voice</label>
                <span className="setting-description">{settings.ttsVoice}</span>
              </div>
            </div>
          )}
        </section>

        {/* Appearance Settings */}
        <section className="settings-section">
          <h3>
            <span className="section-icon">🎨</span>
            Appearance
          </h3>

          <div className="setting-item">
            <div className="setting-info">
              <label>Theme</label>
            </div>
            <div className="theme-options">
              {(['light', 'dark', 'sepia'] as const).map((theme) => (
                <button
                  key={theme}
                  className={`theme-option ${settings.theme === theme ? 'active' : ''}`}
                  onClick={() => saveSettings({ theme })}
                >
                  <span className="theme-icon">
                    {theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '📜'}
                  </span>
                  <span className="theme-label">{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <label>Font Size</label>
              <span className="setting-value">{settings.fontSize}px</span>
            </div>
            <input
              type="range"
              min="12"
              max="24"
              step="2"
              value={settings.fontSize}
              onChange={(e) => saveSettings({ fontSize: parseInt(e.target.value) })}
              className="setting-slider"
            />
            <div className="slider-labels">
              <span>Small</span>
              <span>Normal</span>
              <span>Large</span>
            </div>
          </div>
        </section>

        {/* Storage Settings */}
        <section className="settings-section">
          <h3>
            <span className="section-icon">💾</span>
            Storage
          </h3>

          <div className="setting-item info-item">
            <div className="storage-info">
              <div className="storage-stat">
                <span className="stat-label">Downloaded Books</span>
                <span className="stat-value" id="downloaded-count">-</span>
              </div>
              <div className="storage-stat">
                <span className="stat-label">Storage Used</span>
                <span className="stat-value" id="storage-used">-</span>
              </div>
            </div>
            <button className="btn-secondary clear-cache-btn">
              Clear Cache
            </button>
          </div>
        </section>

        {/* About */}
        <section className="settings-section">
          <h3>
            <span className="section-icon">ℹ️</span>
            About
          </h3>
          <div className="about-info">
            <p><strong>Invron E-Library</strong></p>
            <p>Version 1.0.0</p>
            <p className="muted">© 2025 Invron Labs</p>
          </div>
        </section>
      </div>

      {/* Save indicator */}
      {isSaving && (
        <div className="save-indicator">
          <span>Saving...</span>
        </div>
      )}
    </div>
  );
}
