import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ready Sketch Go',
  description: 'Upload an image and generate a whiteboard-style drawing animation',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <p className="footer-copy">© 2026 Lefty Studios LLC. All rights reserved.</p>
            <div className="footer-links">
              <a href="https://image-toolbox.leftystudios.com/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a>
              <a href="https://image-toolbox.leftystudios.com/terms" target="_blank" rel="noreferrer">Terms of Use</a>
            </div>
            <div className="footer-social">
              <a href="https://x.com/LeftyStudios" aria-label="X (Twitter)" target="_blank" rel="noreferrer">
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M17.53 3H21.5l-7.19 8.21L23 21h-6.18l-4.84-6.41L6.5 21H2.5l7.61-8.7L1 3h6.32l4.36 5.8L17.53 3zm-1.13 15.5h1.7l-5.13-6.8-1.36 1.57L16.4 18.5zm-9.06 0h1.7l2.7-3.13-1.36-1.57-3.04 4.7zm12.5-13.5h-1.7l-2.7 3.13 1.36 1.57 3.04-4.7zm-9.06 0h-1.7l5.13 6.8 1.36-1.57L7.6 5.5z"/></svg>
              </a>
              <a href="https://www.facebook.com/LeftyStudiosLLC/" aria-label="Facebook" target="_blank" rel="noreferrer">
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M22.675 0h-21.35C.595 0 0 .592 0 1.326v21.348C0 23.408.595 24 1.325 24h11.495v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.797.143v3.24l-1.918.001c-1.504 0-1.797.715-1.797 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116C23.406 24 24 23.408 24 22.674V1.326C24 .592 23.406 0 22.675 0"/></svg>
              </a>
              <a href="https://www.youtube.com/@LeftyStudiosLLC" aria-label="YouTube" target="_blank" rel="noreferrer">
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
