{
  description = "Development inputs for send-to-qui. The top-level flake uses them in its dev partition, so they don't appear in consumers' lock files.";

  inputs = {
    github-actions-nix.url = "https://flakehub.com/f/synapdeck/github-actions-nix/*";
    # Newer revisions use the experimental pipe operator.
    files.url = "github:mightyiam/files/2d9d4937e94006ad8f165dfab9dff87cfab7eb2b";
  };

  # This flake is only used for its inputs.
  outputs = _: {};
}
