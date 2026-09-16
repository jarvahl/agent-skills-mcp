{
  description = "Minimal MCP discovery server for Agent Skills";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      apps = forEachSystem (pkgs: {
        default = {
          type = "app";
          program = "${pkgs.writeShellScript "agent-skills-mcp" ''
            exec ${pkgs.nodejs_22}/bin/node "$PWD/dist/index.js" "$@"
          ''}";
        };
      });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.typescript ];
        };
      });
    };
}
