import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../../lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // `max-w-full` + scroll keeps a long tab strip on one line at phone
      // widths rather than wrapping into a two-row block.
      'flex gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto',
      className
    )}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'px-3 sm:px-4 py-1.5 text-sm font-medium rounded-md text-slate-500 transition-all whitespace-nowrap flex-shrink-0',
      'data-[state=active]:bg-white data-[state=active]:text-teal-600 data-[state=active]:shadow-sm',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

const TabsContent = TabsPrimitive.Content

export { Tabs, TabsList, TabsTrigger, TabsContent }
