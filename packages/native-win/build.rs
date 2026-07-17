fn main() {
  // Emits the linker flags a Node addon needs (delay-load of node.exe on
  // Windows). Harmless under plain `cargo check`.
  napi_build::setup();
}
