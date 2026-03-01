# TODO

## Général

- [ ] Gestion multi utilisateur
- [ ] Ajouter des samples depuis son micro
- [ ] Découper longue piste en plusieurs samples
- [ ] Desktop app

## Nouveaux backends TTS

- [ ] GPT-SoVITS
- [ ] IndexTTS2

## Infrastructure

- [x] flash-attn : installé automatiquement dans le variant CUDA via `cuda-nvcc-12-4` et `cuda-cudart-dev-12-4` dans le build stage.

## LoRA Fine-tuning (V2)

Permettre un fine-tuning par profil vocal via LoRA pour une qualité de cloning supérieure au zero-shot.

- [ ] Étudier le pipeline d'entraînement Qwen3-TTS (format dataset JSONL + audio)
- [ ] Créer un worker d'entraînement (subprocess Python) avec streaming du progrès (SSE)
- [ ] Ajouter les endpoints API : CRUD samples de fine-tuning, lancement/arrêt d'entraînement, gestion des adaptateurs
- [ ] Stocker les adaptateurs LoRA (`adapters/{job_id}/`) et les associer aux profils vocaux
- [ ] Intégrer la génération avec adaptateur dans le backend PyTorch (librairie PEFT, cache LRU)
- [ ] UI : onglet fine-tuning avec collecte de samples, paramètres d'entraînement, suivi du progrès, sélecteur d'adaptateur

### Notes

- Nécessite un GPU pour l'entraînement
- Minimum ~10 samples de 5-15s avec transcription, idéalement 20-50
- Applicable principalement à Qwen3-TTS
- Implémenter d'abord la concaténation multi-samples (plus simple, tous backends)
