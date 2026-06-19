import "./globals.css";

export const metadata = {
  title: "upload-stuff — kitchen sink example",
  description: "Full upload-stuff API against local MinIO + Postgres",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
