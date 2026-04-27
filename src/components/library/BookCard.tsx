/**
 * Invron E-Library - Book Card Component
 * 
 * Displays a single book in the library grid
 */

import { useState } from 'react';
import { type Book, isTTSEnabled } from '../../db';
import { downloadManager, type DownloadProgress } from '../../services/downloadManager';
import { requestLocalNotificationPermission, sendLocalNotification } from '../../services/localNotifications';
import './BookCard.css';

// ============================================================================
// TYPES
// ============================================================================

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function BookCard({ book, onOpen }: BookCardProps) {
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const canRead = book.isBundled || book.downloadStatus === 'complete';
  const hasTTS = isTTSEnabled(book);

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  const handleDownload = async () => {
    if (isDownloading) return;

    void requestLocalNotificationPermission();

    setIsDownloading(true);

    // Ensure we have a download URL either from Firebase Storage or local
    const downloadUrl = book.fileUrl;
    
    // If no fileUrl is set, we cannot download
    if (!downloadUrl) {
      console.error('[BookCard] No fileUrl available for download:', book.id);
      setIsDownloading(false);
      return;
    }

    await downloadManager.startDownload(book.id, downloadUrl, {
      onProgress: setDownloadProgress,
      onComplete: () => {
        sendLocalNotification('Download complete', {
          body: `${book.title} is now ready for offline reading.`,
          tag: `download-${book.id}-complete`,
        });
        setIsDownloading(false);
        setDownloadProgress(null);
      },
      onError: (error) => {
        console.error('Download failed:', error);
        sendLocalNotification('Download failed', {
          body: `${book.title}: ${error}`,
          tag: `download-${book.id}-failed`,
          requireInteraction: true,
        });
        setIsDownloading(false);
      }
    });
  };

  const handlePauseDownload = () => {
    downloadManager.pauseDownload(book.id);
    setIsDownloading(false);
  };

  const handleCancelDownload = async () => {
    await downloadManager.cancelDownload(book.id);
    setIsDownloading(false);
    setDownloadProgress(null);
  };

  const handleOpen = () => {
    if (canRead) {
      onOpen(book);
    }
  };

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className={`book-card ${canRead ? 'available' : 'needs-download'}`}>
      {/* Cover Image */}
      <div className="book-cover-container" onClick={handleOpen}>
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={`Cover of ${book.title}`}
            className="book-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="book-cover-placeholder">
            <span className="placeholder-icon">📚</span>
          </div>
        )}

        {/* Status Badges */}
        <div className="book-badges">
          {book.downloadStatus === 'complete' && (
            <span className="badge badge-offline" title="Available offline">
              ✓ Offline
            </span>
          )}
          {hasTTS && (
            <span className="badge badge-audio" title="Audio available">
              🔊
            </span>
          )}
        </div>
      </div>

      {/* Book Info */}
      <div className="book-info">
        <h3 className="book-title" title={book.title}>
          {book.title}
        </h3>
        <p className="book-author">{book.author}</p>
        
        <div className="book-meta">
          <span className="book-type">{book.type.toUpperCase()}</span>
          <span className="book-language">{book.language.toUpperCase()}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="book-actions">
        {canRead ? (
          <button 
            className="btn btn-primary btn-read" 
            onClick={handleOpen}
          >
            📖 Read
          </button>
        ) : isDownloading ? (
          <div className="download-controls">
            {/* Progress Bar */}
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${downloadProgress?.percentage || 0}%` }}
              />
            </div>
            <span className="progress-text">
              {downloadProgress?.percentage || 0}%
            </span>
            <button 
              className="btn btn-small btn-pause" 
              onClick={handlePauseDownload}
              title="Pause download"
            >
              ⏸
            </button>
            <button 
              className="btn btn-small btn-cancel" 
              onClick={handleCancelDownload}
              title="Cancel download"
            >
              ✕
            </button>
          </div>
        ) : (
          <button 
            className="btn btn-secondary btn-download" 
            onClick={handleDownload}
          >
            ⬇ Download
          </button>
        )}
      </div>
    </div>
  );
}
