package main

import (
	"archive/tar"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

func main() {
	srcDir := flag.String("src", "web-ui/dist", "source dist directory")
	outFile := flag.String("out", "web/public/defaultTheme/dist.tar.zst", "output .tar.zst path")
	flag.Parse()

	if err := os.MkdirAll(filepath.Dir(*outFile), 0o755); err != nil {
		fatal(err)
	}
	f, err := os.Create(*outFile)
	if err != nil {
		fatal(err)
	}
	defer f.Close()

	zw, err := zstd.NewWriter(f, zstd.WithEncoderLevel(zstd.SpeedBetterCompression))
	if err != nil {
		fatal(err)
	}
	tw := tar.NewWriter(zw)

	err = filepath.WalkDir(*srcDir, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(*srcDir, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = strings.TrimPrefix(rel, "./")
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tw, in)
		closeErr := in.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if err != nil {
		fatal(err)
	}
	if err := tw.Close(); err != nil {
		fatal(err)
	}
	if err := zw.Close(); err != nil {
		fatal(err)
	}
	fmt.Printf("Packed %s -> %s\n", *srcDir, *outFile)
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "packdist: %v\n", err)
	os.Exit(1)
}
