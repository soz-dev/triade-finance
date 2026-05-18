# Triade Finance

Registre hebdomadaire des cotisations Triade (70 000 par personne, par semaine).

## GitHub Pages

1. **Settings → Pages**
2. Source : **Deploy from a branch**
3. Branch : **main** / dossier **root**
4. Attends 1 à 3 minutes → `https://soz-dev.github.io/triade-finance/`

## Sécurité

1. Exécute `supabase/security.sql` dans le **SQL Editor** Supabase (obligatoire)
2. Le mot de passe admin n'est plus dans le code : vérification côté serveur
3. Les écritures cloud passent par `save_app_state` (RLS bloque les écritures directes)

Changer le mot de passe admin :

```sql
SELECT update_admin_password('triade70', 'ton_nouveau_mot_de_passe');
```

## Test local

Ouvre `index.html` dans le navigateur (`config.js` est déjà présent).
