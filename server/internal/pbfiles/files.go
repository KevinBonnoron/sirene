package pbfiles

import (
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

type Reader struct {
	io.Reader
	closers []io.Closer
}

func (r *Reader) Close() error {
	var first error
	for _, c := range r.closers {
		if err := c.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func Open(app core.App, rec *core.Record, filename string) (*Reader, error) {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, err
	}
	br, err := fsys.GetReader(rec.BaseFilesPath() + "/" + filename)
	if err != nil {
		fsys.Close()
		return nil, err
	}
	return &Reader{Reader: br, closers: []io.Closer{br, fsys}}, nil
}

func ReadAll(app core.App, rec *core.Record, filename string) ([]byte, error) {
	r, err := Open(app, rec, filename)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

type Form struct {
	values map[string][]string
	files  map[string][]*multipart.FileHeader
}

func ParseForm(r *http.Request, maxMemory int64) (*Form, error) {
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(maxMemory); err != nil {
			return nil, err
		}
		return &Form{values: r.MultipartForm.Value, files: r.MultipartForm.File}, nil
	}
	if err := r.ParseForm(); err != nil {
		return nil, err
	}
	return &Form{values: r.PostForm, files: map[string][]*multipart.FileHeader{}}, nil
}

func (f *Form) Has(key string) bool {
	return len(f.values[key]) > 0 || len(f.files[key]) > 0
}

func (f *Form) Value(key string) (string, bool) {
	if v, ok := f.values[key]; ok && len(v) > 0 {
		return v[0], true
	}
	return "", false
}

func (f *Form) IsFile(key string) bool {
	fh, ok := f.files[key]
	return ok && len(fh) > 0
}

func (f *Form) File(key string) (*multipart.FileHeader, bool) {
	fh, ok := f.files[key]
	if !ok || len(fh) == 0 {
		return nil, false
	}
	return fh[0], true
}

func (f *Form) FileBytes(key string) ([]byte, *multipart.FileHeader, error) {
	fh, ok := f.File(key)
	if !ok {
		return nil, nil, nil
	}
	src, err := fh.Open()
	if err != nil {
		return nil, nil, err
	}
	defer src.Close()
	data, err := io.ReadAll(src)
	return data, fh, err
}

func (f *Form) Apply(rec *core.Record, allowed []string) error {
	for _, key := range allowed {
		if fh, ok := f.File(key); ok {
			file, err := filesystem.NewFileFromMultipart(fh)
			if err != nil {
				return err
			}
			rec.Set(key, file)
			continue
		}
		if v, ok := f.Value(key); ok {
			rec.Set(key, v)
		}
	}
	return nil
}
