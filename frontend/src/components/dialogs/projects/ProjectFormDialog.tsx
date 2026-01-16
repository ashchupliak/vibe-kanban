import { useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { CreateProject, Project } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useProjectMutations } from '@/hooks/useProjectMutations';
import { defineModal } from '@/lib/modals';
import { RepoPickerDialog } from '@/components/dialogs/shared/RepoPickerDialog';
import { FolderPickerDialog } from '@/components/dialogs/shared/FolderPickerDialog';
import { fileSystemApi } from '@/lib/api';

export interface ProjectFormDialogProps {}

export type ProjectFormDialogResult =
  | { status: 'saved'; project: Project }
  | { status: 'canceled' };

const getPathBaseName = (value: string) => {
  const trimmed = value.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
};

const normalizePath = (value: string) =>
  value.replace(/[\\/]+/g, '/').replace(/\/+$/, '');

const getRelativePath = (basePath: string, fullPath: string) => {
  const baseNormalized = normalizePath(basePath);
  const fullNormalized = normalizePath(fullPath);
  const baseLower = baseNormalized.toLowerCase();
  const fullLower = fullNormalized.toLowerCase();

  if (fullLower === baseLower) {
    return '';
  }

  if (fullLower.startsWith(`${baseLower}/`)) {
    return fullNormalized.slice(baseNormalized.length + 1);
  }

  return '';
};

const ProjectFormDialogImpl = NiceModal.create<ProjectFormDialogProps>(() => {
  const { t } = useTranslation('projects');
  const modal = useModal();
  const [localError, setLocalError] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  const { createProject } = useProjectMutations({
    onCreateSuccess: (project) => {
      modal.resolve({ status: 'saved', project } as ProjectFormDialogResult);
      modal.hide();
    },
    onCreateError: (err) => {
      setLocalError(
        err instanceof Error
          ? err.message
          : t('createDialog.errors.createFailed')
      );
    },
  });
  const createProjectMutate = createProject.mutate;

  useEffect(() => {
    if (!modal.visible) {
      return;
    }

    setLocalError('');
    setIsScanning(false);
    createProject.reset();
  }, [modal.visible, createProject]);

  const handlePickRepo = useCallback(async () => {
    setLocalError('');
    createProject.reset();

    const repo = await RepoPickerDialog.show({
      title: t('createDialog.repoPicker.title'),
      description: t('createDialog.repoPicker.description'),
    });

    if (!repo) {
      return;
    }

    const projectName = repo.display_name || repo.name;

    const createData: CreateProject = {
      name: projectName,
      repositories: [{ display_name: projectName, git_repo_path: repo.path }],
    };

    createProjectMutate(createData);
  }, [createProjectMutate, createProject, t]);

  const handlePickFolder = useCallback(async () => {
    setLocalError('');
    createProject.reset();

    const selectedPath = await FolderPickerDialog.show({
      title: t('createDialog.folderPicker.title'),
      description: t('createDialog.folderPicker.description'),
    });

    if (!selectedPath) {
      return;
    }

    setIsScanning(true);

    try {
      const repos = await fileSystemApi.listGitRepos(selectedPath);
      if (repos.length === 0) {
        setLocalError(t('createDialog.errors.noRepos'));
        return;
      }

      const projectName = getPathBaseName(selectedPath);
      const dedupedRepos = [];
      const seenPaths = new Set<string>();

      for (const repo of repos) {
        const normalizedPath = normalizePath(repo.path);
        if (seenPaths.has(normalizedPath)) {
          continue;
        }
        seenPaths.add(normalizedPath);
        dedupedRepos.push({
          path: repo.path,
          baseName: repo.name || getPathBaseName(repo.path),
          relativeName: getRelativePath(selectedPath, repo.path),
        });
      }

      const baseNameCounts = dedupedRepos.reduce((acc, repo) => {
        acc.set(repo.baseName, (acc.get(repo.baseName) ?? 0) + 1);
        return acc;
      }, new Map<string, number>());

      const repositories = dedupedRepos
        .map((repo) => {
          const needsDisambiguation = (baseNameCounts.get(repo.baseName) ?? 0) > 1;
          const displayName =
            needsDisambiguation && repo.relativeName
              ? repo.relativeName
              : repo.baseName;
          return {
            display_name: displayName,
            git_repo_path: repo.path,
          };
        })
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      createProjectMutate({
        name: projectName || t('createDialog.defaultName'),
        repositories,
      });
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : t('createDialog.errors.scanFailed')
      );
    } finally {
      setIsScanning(false);
    }
  }, [createProjectMutate, createProject, t]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      modal.resolve({ status: 'canceled' } as ProjectFormDialogResult);
      modal.hide();
    }
  };

  const isCreating = createProject.isPending || isScanning;
  const errorMessage =
    localError ||
    (createProject.isError
      ? createProject.error instanceof Error
        ? createProject.error.message
        : t('createDialog.errors.createFailed')
      : '');

  return (
    <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {isCreating
              ? t('createDialog.creatingTitle')
              : t('createDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {isCreating
              ? t('createDialog.creatingDescription')
              : t('createDialog.description')}
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={handlePickRepo}
              disabled={isCreating}
            >
              <div className="text-left">
                <div className="font-medium">
                  {t('createDialog.options.singleRepo')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('createDialog.options.singleRepoDescription')}
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              onClick={handlePickFolder}
              disabled={isCreating}
            >
              <div className="text-left">
                <div className="font-medium">
                  {t('createDialog.options.folder')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('createDialog.options.folderDescription')}
                </div>
              </div>
            </Button>
          </div>
        )}

        {errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isCreating}
          >
            {t('common:buttons.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export const ProjectFormDialog = defineModal<
  ProjectFormDialogProps,
  ProjectFormDialogResult
>(ProjectFormDialogImpl);
