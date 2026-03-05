"use client";
import React, { useState, useEffect } from 'react';

interface CertificateProps {
  studentName: string;
  unitTitle: string;
  totalPoints: number;
  onClose: () => void;
}

export default function DigitalCertificate({ studentName, unitTitle, totalPoints, onClose }: CertificateProps) {
  const [showConfetti, setShowConfetti] = useState(true);
  const [confettiPieces, setConfettiPieces] = useState<Array<{ id: number; left: number; delay: number; duration: number; color: string }>>([]);

  useEffect(() => {
    // Generate confetti pieces
    const pieces = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 2 + Math.random() * 2,
      color: ['#fbbf24', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6'][Math.floor(Math.random() * 5)]
    }));
    setConfettiPieces(pieces);

    // Stop confetti after 4 seconds
    const timer = setTimeout(() => setShowConfetti(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  const handleDownloadCertificate = () => {
    const certElement = document.getElementById('certificate-content');
    if (!certElement) return;

    // Create a new window for printing
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>BTEC Certificate - ${studentName}</title>
            <style>
              body {
                margin: 0;
                padding: 40px;
                font-family: 'Georgia', serif;
                background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
              }
              .certificate {
                max-width: 800px;
                margin: 0 auto;
                padding: 60px;
                background: white;
                border: 20px solid #16a34a;
                border-radius: 10px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              }
              .header {
                text-align: center;
                border-bottom: 4px solid #16a34a;
                padding-bottom: 30px;
                margin-bottom: 40px;
              }
              .logo { font-size: 80px; margin-bottom: 10px; }
              h1 { color: #16a34a; font-size: 48px; margin: 0; font-weight: bold; }
              h2 { color: #333; font-size: 28px; margin: 10px 0; }
              .content { text-align: center; margin: 40px 0; }
              .student-name {
                font-size: 42px;
                color: #16a34a;
                font-weight: bold;
                margin: 20px 0;
                padding: 20px;
                border-bottom: 3px solid #16a34a;
                display: inline-block;
              }
              .body-text { font-size: 18px; color: #555; line-height: 1.8; margin: 30px 0; }
              .points {
                font-size: 36px;
                color: #16a34a;
                font-weight: bold;
                margin: 30px 0;
              }
              .footer {
                margin-top: 60px;
                padding-top: 30px;
                border-top: 2px solid #e5e7eb;
                display: flex;
                justify-content: space-around;
                align-items: flex-end;
              }
              .signature {
                text-align: center;
                flex: 1;
              }
              .signature-line {
                border-top: 2px solid #333;
                margin-bottom: 10px;
                width: 200px;
                margin-left: auto;
                margin-right: auto;
              }
              .signature-title { font-size: 14px; color: #666; }
              .seal {
                font-size: 80px;
                opacity: 0.1;
                position: absolute;
                bottom: 50px;
                right: 50px;
              }
              @media print {
                body { background: white; padding: 0; }
                .certificate { box-shadow: none; }
              }
            </style>
          </head>
          <body onload="window.print(); window.close();">
            <div class="certificate">
              <div class="seal">🎓</div>
              <div class="header">
                <div class="logo">🌾</div>
                <h1>BTEC CERTIFICATE</h1>
                <h2>Level 2 Business</h2>
              </div>
              
              <div class="content">
                <p class="body-text">This is to certify that</p>
                
                <div class="student-name">${studentName}</div>
                
                <p class="body-text">
                  has successfully completed the virtual learning module<br/>
                  <strong>${unitTitle}</strong>
                </p>
                
                <p class="body-text">
                  demonstrating excellent understanding of agricultural business purposes,<br/>
                  PESTLE analysis, and business environment factors.
                </p>
                
                <div class="points">🏆 ${totalPoints} XP Earned</div>
                
                <p class="body-text" style="font-size: 14px; color: #888;">
                  Issued on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              
              <div class="footer">
                <div class="signature">
                  <div class="signature-line"></div>
                  <p class="signature-title">Lead Instructor</p>
                </div>
                <div class="signature">
                  <div class="signature-line"></div>
                  <p class="signature-title">Academic Director</p>
                </div>
              </div>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="fixed inset-0 z-[400] bg-black/95 backdrop-blur-sm flex items-center justify-center p-4 overflow-hidden">
      {/* Confetti Animation */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {confettiPieces.map(piece => (
            <div
              key={piece.id}
              className="absolute top-0 w-3 h-3 rounded-full animate-fall"
              style={{
                left: `${piece.left}%`,
                backgroundColor: piece.color,
                animationDelay: `${piece.delay}s`,
                animationDuration: `${piece.duration}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Certificate Content */}
      <div 
        id="certificate-content"
        className="relative bg-gradient-to-br from-white to-green-50 border-8 border-green-600 rounded-2xl p-12 max-w-4xl w-full shadow-2xl animate-scale-in"
        style={{ boxShadow: '0 0 100px rgba(34, 197, 94, 0.5)' }}
      >
        {/* Decorative Seal */}
        <div className="absolute top-8 right-8 text-8xl opacity-10 rotate-12">🎓</div>
        
        {/* Header */}
        <div className="text-center border-b-4 border-green-600 pb-8 mb-8">
          <div className="text-8xl mb-4">🌾</div>
          <h1 className="text-6xl font-black text-green-600 mb-2">BTEC CERTIFICATE</h1>
          <h2 className="text-3xl font-bold text-gray-700">Level 2 Business</h2>
        </div>

        {/* Content */}
        <div className="text-center space-y-6">
          <p className="text-xl text-gray-600">This is to certify that</p>
          
          <div className="my-8">
            <div className="text-5xl font-black text-green-600 border-b-4 border-green-600 pb-4 inline-block px-8">
              {studentName}
            </div>
          </div>

          <p className="text-lg text-gray-700 leading-relaxed max-w-2xl mx-auto">
            has successfully completed the virtual learning module<br/>
            <span className="font-bold text-xl text-green-700">{unitTitle}</span>
          </p>

          <p className="text-base text-gray-600 leading-relaxed max-w-2xl mx-auto mt-4">
            demonstrating excellent understanding of agricultural business purposes,<br/>
            PESTLE analysis, and business environment factors.
          </p>

          <div className="my-8 text-5xl font-black text-green-600">
            🏆 {totalPoints} XP Earned
          </div>

          <p className="text-sm text-gray-500">
            Issued on {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>

        {/* Footer Signatures */}
        <div className="mt-12 pt-8 border-t-2 border-gray-300 flex justify-around">
          <div className="text-center">
            <div className="border-t-2 border-gray-800 w-48 mb-2"></div>
            <p className="text-sm text-gray-600 font-semibold">Lead Instructor</p>
          </div>
          <div className="text-center">
            <div className="border-t-2 border-gray-800 w-48 mb-2"></div>
            <p className="text-sm text-gray-600 font-semibold">Academic Director</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex gap-4 justify-center">
          <button
            onClick={handleDownloadCertificate}
            className="px-8 py-3 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 transition-all shadow-lg hover:shadow-green-500/50"
          >
            📥 تحميل الشهادة
          </button>
          <button
            onClick={onClose}
            className="px-8 py-3 rounded-xl font-bold bg-gray-600 text-white hover:bg-gray-700 transition-all"
          >
            ✕ إغلاق
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fall {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-fall {
          animation: fall linear forwards;
        }
        @keyframes scale-in {
          0% {
            transform: scale(0.5);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-scale-in {
          animation: scale-in 0.5s ease-out;
        }
      `}</style>
    </div>
  );
}
