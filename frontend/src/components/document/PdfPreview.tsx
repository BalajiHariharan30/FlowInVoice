import React, { useEffect, useMemo } from "react";

export interface PdfPreviewProps {
  file: File | null;
  className?: string;
}

export const PdfPreview: React.FC<PdfPreviewProps> = ({ file, className = "w-full h-full" }) => {
  // Memoized — only regenerates when `file` actually changes, not on every render
  const objectUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  // Clean up object URL on unmount or file change to prevent memory leaks
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  if (!objectUrl) return null;

  return (
    <embed
      src={objectUrl}
      type="application/pdf"
      className={className}
    />
  );
};
