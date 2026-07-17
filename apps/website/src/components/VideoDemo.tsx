export function VideoDemo() {
  return (
    <div className="demo-frame">
      <video src="/demo.mp4" poster="/demo-poster.png" autoPlay loop muted playsInline />
    </div>
  );
}
