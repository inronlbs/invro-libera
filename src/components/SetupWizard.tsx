/**
 * SetupWizard — Full-screen onboarding overlay shown when no license key is found.
 * Allows the host to import a .invronkey file to activate the app.
 */

import React, { useState, useCallback } from 'react';
import { importKeyFile, activateLicense, type LicenseData, daysRemaining } from '../services/licenseService';
import Titlebar from './layout/Titlebar';

interface SetupWizardProps {
  onActivated: () => void;
  expiredLicense?: LicenseData | null;
}

export default function SetupWizard({ onActivated, expiredLicense }: SetupWizardProps) {
  const [step, setStep] = useState<'welcome' | 'import' | 'confirm' | 'error'>(
    expiredLicense ? 'import' : 'welcome'
  );
  const [licenseData, setLicenseData] = useState<LicenseData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [activating, setActivating] = useState(false);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const data = await importKeyFile(buffer);

      // Check if already expired
      if (new Date(data.expires_at) < new Date()) {
        setErrorMsg(`This key expired on ${data.expires_at}. Please request a new key.`);
        setStep('error');
        return;
      }

      setLicenseData(data);
      setStep('confirm');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || 'Failed to read key file');
      setStep('error');
    }
  }, []);

  const handleActivate = async () => {
    if (!licenseData) return;
    setActivating(true);
    try {
      await activateLicense(licenseData);
      onActivated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg || 'Activation failed');
      setStep('error');
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <Titlebar />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full">
          {/* Logo */}
          <div className="text-center mb-8">
            <img src="/assets/logos/logo-txt-dark.png" alt="Invro Libera" className="h-[120px] mx-auto object-contain mb-4 drop-shadow-sm" />
            <p className="text-sm font-semibold text-slate-500 mt-1 uppercase tracking-widest">Host Application</p>
          </div>

          {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <span className="material-symbols-outlined text-[48px] text-primary mb-4 block">key</span>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Welcome!</h2>
            <p className="text-sm text-slate-500 mb-6">
              To get started, you'll need an activation key file provided by your administrator.
              Import the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-primary">.invronkey</code> file to activate this device.
            </p>
            <button
              onClick={() => setStep('import')}
              className="w-full px-6 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-primary/20"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Import Step */}
        {step === 'import' && (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
            {expiredLicense && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-center">
                <span className="material-symbols-outlined text-red-500 text-2xl mb-1 block">warning</span>
                <p className="text-sm font-semibold text-red-700">License Expired</p>
                <p className="text-xs text-red-500 mt-1">
                  Key <code className="font-mono">{expiredLicense.key}</code> expired on {expiredLicense.expires_at}.
                  Please import a new key file.
                </p>
              </div>
            )}
            <h2 className="text-lg font-bold text-slate-800 mb-2 text-center">Import Activation Key</h2>
            <p className="text-sm text-slate-500 mb-6 text-center">
              Select the <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">.invronkey</code> file from your administrator.
            </p>
            <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
              <span className="material-symbols-outlined text-[36px] text-slate-400 mb-2">upload_file</span>
              <span className="text-sm font-semibold text-slate-600">Click to select .invronkey file</span>
              <span className="text-xs text-slate-400 mt-1">Encrypted activation file</span>
              <input
                type="file"
                accept=".invronkey"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
            {!expiredLicense && (
              <button onClick={() => setStep('welcome')} className="mt-4 text-sm text-slate-400 hover:text-slate-600 transition-colors w-full text-center">
                ← Back
              </button>
            )}
          </div>
        )}

        {/* Confirm Step */}
        {step === 'confirm' && licenseData && (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-[48px] text-emerald-500 mb-2 block animate-in zoom-in duration-300">verified</span>
              <h2 className="text-lg font-bold text-slate-800">Key Verified</h2>
              <p className="text-sm text-slate-500">Review the details and activate.</p>
            </div>

            <div className="space-y-3 bg-slate-50 rounded-xl p-5 mb-6">
              <InfoRow label="License Key" value={licenseData.key} mono />
              <InfoRow label="School" value={licenseData.school_name} />
              {licenseData.lab_name && <InfoRow label="Lab" value={licenseData.lab_name} />}
              {licenseData.device_id && <InfoRow label="Device ID" value={licenseData.device_id} />}
              <InfoRow label="Issued" value={licenseData.issued_at} />
              <InfoRow label="Expires" value={`${licenseData.expires_at} (${daysRemaining(licenseData.expires_at)} days remaining)`} />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep('import')} className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-semibold text-sm hover:bg-slate-200 transition-all">
                Back
              </button>
              <button onClick={handleActivate} disabled={activating}
                className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50">
                {activating ? 'Activating…' : 'Activate'}
              </button>
            </div>
          </div>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <span className="material-symbols-outlined text-[48px] text-red-500 mb-4 block">error</span>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Activation Failed</h2>
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl mb-6">{errorMsg}</p>
            <button onClick={() => setStep('import')}
              className="px-6 py-3 bg-slate-800 text-white rounded-xl font-bold text-sm transition-all hover:bg-slate-900 shadow-md">
              Try Again
            </button>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">Invron Labs © {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-semibold text-slate-700 ${mono ? 'font-mono bg-white px-2 py-0.5 rounded-lg border border-slate-200' : ''}`}>{value}</span>
    </div>
  );
}
