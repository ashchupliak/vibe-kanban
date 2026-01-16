import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import RepoBranchSelector from '@/components/tasks/RepoBranchSelector';
import { ExecutorProfileSelector } from '@/components/settings';
import { useAttemptCreation } from '@/hooks/useAttemptCreation';
import {
  useNavigateWithSearch,
  useTask,
  useAttempt,
  useRepoBranchSelection,
  useProjectRepos,
} from '@/hooks';
import { useTaskAttemptsWithSessions } from '@/hooks/useTaskAttempts';
import { useProject } from '@/contexts/ProjectContext';
import { useUserSystem } from '@/components/ConfigProvider';
import { configApi } from '@/lib/api';
import { paths } from '@/lib/paths';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { BaseCodingAgent } from 'shared/types';
import type { ExecutorProfileId } from 'shared/types';
import { getJbaiModelOptions } from '@/utils/jbai-models';
import { useKeySubmitTask, Scope } from '@/keyboard';

export interface CreateAttemptDialogProps {
  taskId: string;
}

const CreateAttemptDialogImpl = NiceModal.create<CreateAttemptDialogProps>(
  ({ taskId }) => {
    const modal = useModal();
    const navigate = useNavigateWithSearch();
    const { projectId } = useProject();
    const { t } = useTranslation('tasks');
    const { profiles, config } = useUserSystem();
    const { createAttempt, isCreating, error } = useAttemptCreation({
      taskId,
      onSuccess: (attempt) => {
        if (projectId) {
          navigate(paths.attempt(projectId, taskId, attempt.id));
        }
      },
    });

    const [userSelectedProfile, setUserSelectedProfile] =
      useState<ExecutorProfileId | null>(null);
    const [jbaiModelOverride, setJbaiModelOverride] = useState<string | null>(
      null
    );

    const { data: attempts = [], isLoading: isLoadingAttempts } =
      useTaskAttemptsWithSessions(taskId, {
        enabled: modal.visible,
        refetchInterval: 5000,
      });

    const { data: task, isLoading: isLoadingTask } = useTask(taskId, {
      enabled: modal.visible,
    });

    const parentAttemptId = task?.parent_workspace_id ?? undefined;
    const { data: parentAttempt, isLoading: isLoadingParent } = useAttempt(
      parentAttemptId,
      { enabled: modal.visible && !!parentAttemptId }
    );

    const { data: projectRepos = [], isLoading: isLoadingRepos } =
      useProjectRepos(projectId, { enabled: modal.visible });

    const {
      configs: repoBranchConfigs,
      isLoading: isLoadingBranches,
      setRepoBranch,
      getWorkspaceRepoInputs,
      reset: resetBranchSelection,
    } = useRepoBranchSelection({
      repos: projectRepos,
      initialBranch: parentAttempt?.branch,
      enabled: modal.visible && projectRepos.length > 0,
    });

    const latestAttempt = useMemo(() => {
      if (attempts.length === 0) return null;
      return attempts.reduce((latest, attempt) =>
        new Date(attempt.created_at) > new Date(latest.created_at)
          ? attempt
          : latest
      );
    }, [attempts]);

    useEffect(() => {
      if (!modal.visible) {
        setUserSelectedProfile(null);
        setJbaiModelOverride(null);
        resetBranchSelection();
      }
    }, [modal.visible, resetBranchSelection]);

    const defaultProfile: ExecutorProfileId | null = useMemo(() => {
      if (latestAttempt?.session?.executor) {
        const lastExec = latestAttempt.session.executor as BaseCodingAgent;
        // If the last attempt used the same executor as the user's current preference,
        // we assume they want to use their preferred variant as well.
        // Otherwise, we default to the "default" variant (null) since we don't know
        // what variant they used last time (TaskAttempt doesn't store it).
        const variant =
          config?.executor_profile?.executor === lastExec
            ? config.executor_profile.variant
            : null;

        return {
          executor: lastExec,
          variant,
        };
      }
      return config?.executor_profile ?? null;
    }, [latestAttempt?.session?.executor, config?.executor_profile]);

    const effectiveProfile = userSelectedProfile ?? defaultProfile;
    const isJbaiSelected =
      effectiveProfile?.executor === BaseCodingAgent.JBAI;

    const jbaiClient = useMemo(() => {
      if (!isJbaiSelected || !profiles || !effectiveProfile) {
        return 'CLAUDE';
      }
      const variant = effectiveProfile.variant ?? 'DEFAULT';
      const executorConfigs = profiles[effectiveProfile.executor];
      const variantConfig =
        executorConfigs?.[variant] as Record<string, unknown> | undefined;
      const jbaiConfig = variantConfig?.JBAI as { client?: string } | undefined;
      return jbaiConfig?.client ?? 'CLAUDE';
    }, [isJbaiSelected, profiles, effectiveProfile]);

    const { data: jbaiModels } = useQuery({
      queryKey: ['jbai-models'],
      queryFn: configApi.getJbaiModels,
      staleTime: 5 * 60 * 1000,
      enabled: modal.visible && isJbaiSelected,
    });

    const jbaiModelOptions = useMemo(() => {
      if (!isJbaiSelected) {
        return [];
      }
      const dynamicOptions: Record<string, string[]> | null = jbaiModels
        ? {
            CLAUDE: jbaiModels.claude.available,
            CODEX: jbaiModels.codex.available,
            GEMINI: jbaiModels.gemini.available,
            OPENCODE: jbaiModels.opencode.available,
          }
        : null;
      return dynamicOptions?.[jbaiClient] ?? getJbaiModelOptions(jbaiClient);
    }, [isJbaiSelected, jbaiClient, jbaiModels]);

    useEffect(() => {
      if (!isJbaiSelected) {
        if (jbaiModelOverride) {
          setJbaiModelOverride(null);
        }
        return;
      }

      if (
        jbaiModelOverride &&
        jbaiModelOptions.length > 0 &&
        !jbaiModelOptions.includes(jbaiModelOverride)
      ) {
        setJbaiModelOverride(null);
      }
    }, [isJbaiSelected, jbaiModelOverride, jbaiModelOptions]);

    const isLoadingInitial =
      isLoadingRepos ||
      isLoadingBranches ||
      isLoadingAttempts ||
      isLoadingTask ||
      isLoadingParent;

    const allBranchesSelected = repoBranchConfigs.every(
      (c) => c.targetBranch !== null
    );

    const canCreate = Boolean(
      effectiveProfile &&
        allBranchesSelected &&
        projectRepos.length > 0 &&
        !isCreating &&
        !isLoadingInitial
    );

    const handleCreate = async () => {
      if (
        !effectiveProfile ||
        !allBranchesSelected ||
        projectRepos.length === 0
      )
        return;
      try {
        const repos = getWorkspaceRepoInputs();

        await createAttempt({
          profile: effectiveProfile,
          repos,
          modelOverride: jbaiModelOverride,
        });

        modal.hide();
      } catch (err) {
        console.error('Failed to create attempt:', err);
      }
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) modal.hide();
    };

    useKeySubmitTask(handleCreate, {
      enabled: modal.visible && canCreate,
      scope: Scope.DIALOG,
      preventDefault: true,
    });

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('createAttemptDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('createAttemptDialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {profiles && (
              <div className="space-y-2">
                <ExecutorProfileSelector
                  profiles={profiles}
                  selectedProfile={effectiveProfile}
                  onProfileSelect={setUserSelectedProfile}
                  showLabel={true}
                />
              </div>
            )}

            <RepoBranchSelector
              configs={repoBranchConfigs}
              onBranchChange={setRepoBranch}
              isLoading={isLoadingBranches}
              className="space-y-2"
            />

            {isJbaiSelected && (
              <div className="space-y-2">
                <Label htmlFor="jbai-model">
                  {t('taskFormDialog.jbaiModel.label')}
                </Label>
                <Select
                  value={jbaiModelOverride ?? '__default__'}
                  onValueChange={(value) =>
                    setJbaiModelOverride(
                      value === '__default__' ? null : value
                    )
                  }
                  disabled={isCreating || isLoadingInitial}
                >
                  <SelectTrigger id="jbai-model">
                    <SelectValue
                      placeholder={t('taskFormDialog.jbaiModel.placeholder')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">
                      {t('taskFormDialog.jbaiModel.defaultOption')}
                    </SelectItem>
                    {jbaiModelOptions.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('taskFormDialog.jbaiModel.helper')}
                </p>
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive">
                {t('createAttemptDialog.error')}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => modal.hide()}
              disabled={isCreating}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={!canCreate}>
              {isCreating
                ? t('createAttemptDialog.creating')
                : t('createAttemptDialog.start')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateAttemptDialog = defineModal<CreateAttemptDialogProps, void>(
  CreateAttemptDialogImpl
);
